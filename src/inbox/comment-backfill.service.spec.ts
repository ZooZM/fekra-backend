import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsService } from '@app/clients/clients.service';
import { GraphToken } from '@app/clients/types/client.types';
import { BackfillRunStore, RunRef, StoredRun } from './backfill-run.store';
import { CommentBackfillService } from './comment-backfill.service';
import { GraphError } from './graph-api.service';
import { InboxItem, Platform } from './inbox.types';
import {
  PostComment,
  PostCommentsService,
  RecheckOutcome,
} from './post-comments.service';
import { PriorityInboxService } from './priority-inbox.service';
import {
  BackfillRunState,
  InterruptReason,
} from './schemas/comment-backfill.schema';

const PAGE = '11111111111';
const IG = '22222222222';
const POST = `${PAGE}_33333333333`;
const CLIENT_ID = 'c1111111-1111-4111-8111-111111111111';
const AUTH: GraphToken = { token: 'token', api: 'facebook' }; // a Page token
const actor = {
  id: 'a1111111-1111-4111-8111-111111111111',
  name: 'Admin',
  email: 'admin@example.com',
};
const other = {
  id: 'b2222222-2222-4222-8222-222222222222',
  name: 'Other admin',
  email: 'other@example.com',
};

/** Lets the background worker run to completion (the delay is 0 in most tests). */
const flush = async () => {
  for (let i = 0; i < 40; i++) await new Promise((r) => setImmediate(r));
};

/** The few store behaviors the service relies on, in memory, so tests assert outcomes. */
class FakeStore {
  runs = new Map<string, StoredRun>();
  locks = new Map<string, string>();
  latest = new Map<string, string>();
  private lockKey = (p: Platform, post: string) => `${p}:${post}`;
  private view = (r: StoredRun): StoredRun => ({
    ...r,
    handled: r.queued + r.dropped + r.skipped,
  });

  acquireLock = jest.fn((p: Platform, post: string, runId: string) => {
    const key = this.lockKey(p, post);
    if (this.locks.has(key)) return Promise.resolve(false);
    this.locks.set(key, runId);
    return Promise.resolve(true);
  });
  lockHolder = jest.fn((p: Platform, post: string) =>
    Promise.resolve(this.locks.get(this.lockKey(p, post)) ?? null),
  );
  renewLock = jest.fn((run: RunRef) =>
    Promise.resolve(
      this.locks.get(this.lockKey(run.platform, run.postId)) === run.id,
    ),
  );
  releaseLock = jest.fn((run: RunRef) => {
    const key = this.lockKey(run.platform, run.postId);
    if (this.locks.get(key) === run.id) this.locks.delete(key);
    return Promise.resolve();
  });
  create = jest.fn((run: StoredRun) => {
    this.runs.set(run.id, { ...run });
    this.latest.set(this.lockKey(run.platform, run.postId), run.id);
    return Promise.resolve();
  });
  get = jest.fn((id: string) => {
    const r = this.runs.get(id);
    return Promise.resolve(r ? this.view(r) : null);
  });
  incr = jest.fn((id: string, field: 'queued' | 'dropped' | 'skipped') => {
    const r = this.runs.get(id);
    if (r) r[field] += 1;
    return Promise.resolve();
  });
  stop = jest.fn(
    (run: RunRef, by: { id: string; name: string }, _ttl: number) => {
      const r = this.runs.get(run.id);
      if (!r) return Promise.resolve(null);
      if (r.state !== 'running') return Promise.resolve(r.state);
      r.state = 'stopped';
      r.stoppedBy = { id: by.id, name: by.name };
      r.endedAt = new Date().toISOString();
      this.free(r);
      return Promise.resolve<BackfillRunState>('running');
    },
  );
  end = jest.fn(
    (
      run: RunRef,
      state: 'finished' | 'interrupted',
      reason: InterruptReason | null,
      _ttl: number,
    ) => {
      const r = this.runs.get(run.id);
      if (!r || r.state !== 'running') return Promise.resolve(false);
      r.state = state;
      r.interruptReason = reason;
      r.endedAt = new Date().toISOString();
      this.free(r);
      return Promise.resolve(true);
    },
  );
  markStaleIfLockLost = jest.fn((run: RunRef, _ttl: number) => {
    const r = this.runs.get(run.id);
    const holder = this.locks.get(this.lockKey(run.platform, run.postId));
    if (!r || r.state !== 'running' || holder === run.id) {
      return Promise.resolve(false);
    }
    r.state = 'interrupted';
    r.interruptReason = 'SERVER_RESTART';
    return Promise.resolve(true);
  });
  latestForPosts = jest.fn((p: Platform, postIds: string[]) => {
    const out = new Map<string, StoredRun>();
    for (const post of postIds) {
      const id = this.latest.get(this.lockKey(p, post));
      const r = id ? this.runs.get(id) : undefined;
      if (r) out.set(post, this.view(r));
    }
    return Promise.resolve(out);
  });

  private free(r: StoredRun) {
    const key = this.lockKey(r.platform, r.postId);
    if (this.locks.get(key) === r.id) this.locks.delete(key);
  }
  /** The only run created in a test. */
  only(): StoredRun {
    const [r] = [...this.runs.values()];
    return this.view(r);
  }
}

describe('CommentBackfillService', () => {
  let service: CommentBackfillService;
  let store: FakeStore;
  let clients: {
    getClientDataForWorkFlow: jest.Mock;
    getGraphToken: jest.Mock;
    findById: jest.Mock;
    recordReplyRun: jest.Mock;
  };
  let postComments: { listUnreplied: jest.Mock; recheck: jest.Mock };
  let inbox: {
    push: jest.Mock<Promise<boolean>, [InboxItem, { skipRateLimit?: boolean }]>;
  };
  let env: Record<string, string>;

  const pushed = () => inbox.push.mock.calls.map(([item]) => item);
  const config = (over: Partial<Record<string, unknown>> = {}) => ({
    id: CLIENT_ID,
    name: 'Acme',
    fbPageId: PAGE,
    instaAccountId: IG,
    commentReplyConfig: { enabled: true },
    ...over,
  });

  const comment = (
    id: string,
    over: Partial<PostComment> = {},
  ): PostComment => ({
    id,
    text: `text ${id}`,
    senderId: `sender-${id}`,
    createdAt: 1,
    hidden: false,
    replierIds: [],
    ...over,
  });

  const unreplied = (list: PostComment[], checked = list.length) =>
    postComments.listUnreplied.mockResolvedValue({
      checked,
      unreplied: list,
      truncated: false,
    });

  const start = (accountId = PAGE, postId = POST, by = actor) =>
    service.start({ accountId, postId }, by);

  beforeEach(() => {
    env = { COMMENT_BACKFILL_DELAY_MS: '0' };
    store = new FakeStore();
    clients = {
      getClientDataForWorkFlow: jest.fn().mockResolvedValue(config()),
      getGraphToken: jest.fn().mockResolvedValue(AUTH),
      findById: jest.fn().mockResolvedValue(config()),
      recordReplyRun: jest.fn().mockResolvedValue(undefined),
    };
    postComments = {
      listUnreplied: jest.fn().mockResolvedValue({
        checked: 0,
        unreplied: [],
        truncated: false,
      }),
      recheck: jest
        .fn<Promise<RecheckOutcome>, [Platform, string, string, GraphToken]>()
        .mockResolvedValue('needs_reply'),
    };
    inbox = {
      push: jest
        .fn<Promise<boolean>, [InboxItem, { skipRateLimit?: boolean }]>()
        .mockResolvedValue(true),
    };
    service = new CommentBackfillService(
      clients as unknown as ClientsService,
      inbox as unknown as PriorityInboxService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
      postComments as unknown as PostCommentsService,
      store as unknown as BackfillRunStore,
    );
  });

  // ─────────────────────────── start: refusals ───────────────────────────

  describe('start refusals', () => {
    it('404s when no client owns the account', async () => {
      clients.getClientDataForWorkFlow.mockResolvedValue(null);
      await expect(start()).rejects.toBeInstanceOf(NotFoundException);
      expect(store.acquireLock).not.toHaveBeenCalled();
    });

    it('409 COMMENT_REPLIES_DISABLED when comment replies are off, before anything else is done', async () => {
      clients.getClientDataForWorkFlow.mockResolvedValue(
        config({ commentReplyConfig: { enabled: false } }),
      );

      const thrown = await start().catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).getResponse()).toMatchObject({
        errorCode: 'COMMENT_REPLIES_DISABLED',
      });
      expect(clients.getGraphToken).not.toHaveBeenCalled();
      expect(store.acquireLock).not.toHaveBeenCalled();
      expect(postComments.listUnreplied).not.toHaveBeenCalled();
    });

    it('400s when the client has no access token, without taking the lock', async () => {
      clients.getGraphToken.mockResolvedValue(null);
      await expect(start()).rejects.toBeInstanceOf(BadRequestException);
      expect(store.acquireLock).not.toHaveBeenCalled();
    });

    it('409 CONFLICT naming the run in progress when the post is already locked', async () => {
      store.locks.set(`facebook:${POST}`, 'run-in-progress');

      const thrown = await start().catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).getResponse()).toMatchObject({
        errorCode: 'CONFLICT',
        details: { runId: 'run-in-progress' },
      });
      expect(postComments.listUnreplied).not.toHaveBeenCalled();
      expect(store.locks.get(`facebook:${POST}`)).toBe('run-in-progress'); // not freed by the loser
    });

    it('lets only one of two parallel starts through', async () => {
      unreplied([comment('a')]);
      const results = await Promise.allSettled([
        start(),
        start(PAGE, POST, other),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(store.runs.size).toBe(1);
    });
  });

  // ─────────────────────────── start: failures free the post ───────────────────────────

  describe('start failures', () => {
    const fail = (err: unknown) => {
      postComments.listUnreplied.mockRejectedValueOnce(err);
      return start();
    };

    it('404 META_POST_NOT_FOUND for a post that does not exist (code 100 / 33)', async () => {
      const thrown = await fail(
        new GraphError('Graph 400 code=100', false, 100, 33),
      ).catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect((thrown as NotFoundException).getResponse()).toMatchObject({
        errorCode: 'META_POST_NOT_FOUND',
        details: { graphCode: 100, graphSubcode: 33 },
      });
      expect((thrown as Error).message).toContain(POST);
    });

    it('400 META_TOKEN_INVALID for an expired token (190)', async () => {
      const thrown = await fail(new GraphError('x', false, 190, 463)).catch(
        (e: unknown) => e,
      );
      expect(thrown).toBeInstanceOf(BadRequestException);
      expect((thrown as BadRequestException).getResponse()).toMatchObject({
        errorCode: 'META_TOKEN_INVALID',
      });
    });

    it('400 META_PERMISSION_DENIED for a missing permission (200)', async () => {
      const thrown = await fail(new GraphError('x', false, 200)).catch(
        (e: unknown) => e,
      );
      expect((thrown as BadRequestException).getResponse()).toMatchObject({
        errorCode: 'META_PERMISSION_DENIED',
      });
    });

    it('503 when Meta is still unavailable after the retries', async () => {
      await expect(fail(new GraphError('x', true, 2))).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });

    it('502 for any other Meta rejection', async () => {
      await expect(
        fail(new GraphError('x', false, 1234)),
      ).rejects.toBeInstanceOf(BadGatewayException);
    });

    it('passes an error that is not from Meta on unchanged', async () => {
      await expect(fail(new Error('boom'))).rejects.toThrow('boom');
    });

    it('frees the post after a failure, so it can be retried', async () => {
      await fail(new GraphError('x', false, 100, 33)).catch(() => undefined);
      expect(store.locks.size).toBe(0);

      unreplied([comment('a')]);
      await expect(start()).resolves.toMatchObject({ pending: 1 });
    });

    it('answers 202 with run null, frees the post and records nothing when no comment needs a reply', async () => {
      unreplied([], 5);

      const result = await start();

      expect(result).toEqual({
        platform: 'facebook',
        postId: POST,
        total: 5,
        pending: 0,
        delaySeconds: 0,
        run: null,
      });
      expect(store.locks.size).toBe(0);
      expect(store.create).not.toHaveBeenCalled();
      expect(clients.recordReplyRun).not.toHaveBeenCalled();
      expect(inbox.push).not.toHaveBeenCalled();
    });

    it('starts no run and frees the post when the activity record cannot be written', async () => {
      unreplied([comment('a'), comment('b')]);
      clients.recordReplyRun.mockRejectedValue(new Error('db down'));

      await expect(start()).rejects.toThrow('db down');
      await flush();

      expect(store.locks.size).toBe(0);
      expect(store.create).not.toHaveBeenCalled();
      expect(inbox.push).not.toHaveBeenCalled();
    });

    it('frees the post when the run cannot be stored', async () => {
      unreplied([comment('a')]);
      store.create.mockRejectedValueOnce(new Error('redis down'));

      await expect(start()).rejects.toThrow('redis down');
      await flush();

      expect(store.locks.size).toBe(0);
      expect(inbox.push).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────── start: success ───────────────────────────

  describe('start', () => {
    it('asks for the unreplied comments of the right platform', async () => {
      await start();
      expect(postComments.listUnreplied).toHaveBeenCalledWith(
        'facebook',
        PAGE,
        POST,
        AUTH,
      );
      expect(clients.getGraphToken).toHaveBeenCalledWith(CLIENT_ID, 'facebook');

      await start(IG, '444444');
      expect(clients.getGraphToken).toHaveBeenLastCalledWith(
        CLIENT_ID,
        'instagram',
      );
      expect(postComments.listUnreplied).toHaveBeenLastCalledWith(
        'instagram',
        IG,
        '444444',
        AUTH,
      );
    });

    it('reads and re-checks Instagram comments with the Instagram token when the client has one', async () => {
      const igAuth: GraphToken = { token: 'ig-token', api: 'instagram' };
      clients.getGraphToken.mockResolvedValue(igAuth);
      unreplied([comment('a')]);

      await start(IG, '444444');
      await flush();

      expect(postComments.listUnreplied).toHaveBeenCalledWith(
        'instagram',
        IG,
        '444444',
        igAuth,
      );
      expect(postComments.recheck).toHaveBeenCalledWith(
        'instagram',
        IG,
        'a',
        igAuth,
      );
    });

    it('records the start in the activity record before the worker begins', async () => {
      unreplied([comment('a'), comment('b')]);
      let pushesAtRecordTime = -1;
      clients.recordReplyRun.mockImplementation(() => {
        pushesAtRecordTime = inbox.push.mock.calls.length;
        return Promise.resolve();
      });

      const { run } = await start();

      expect(pushesAtRecordTime).toBe(0);
      expect(clients.recordReplyRun).toHaveBeenCalledWith(
        { id: CLIENT_ID, name: 'Acme' },
        'REPLY_RUN_STARTED',
        actor,
        {
          runId: run?.id,
          platform: 'facebook',
          accountId: PAGE,
          postId: POST,
          toAnswer: 2,
        },
      );
    });

    it('returns the counts and a new run, without any email or client name', async () => {
      env.COMMENT_BACKFILL_DELAY_MS = '5000';
      unreplied([comment('a'), comment('b'), comment('c')], 12);

      const result = await start();

      expect(result).toMatchObject({
        platform: 'facebook',
        postId: POST,
        total: 12,
        pending: 3,
        delaySeconds: 5,
      });
      const run = result.run!;
      expect(run).toMatchObject({
        clientId: CLIENT_ID,
        accountId: PAGE,
        platform: 'facebook',
        postId: POST,
        state: 'running',
        interruptReason: null,
        total: 12,
        toAnswer: 3,
        handled: 0,
        queued: 0,
        dropped: 0,
        skipped: 0,
        delaySeconds: 5,
        endedAt: null,
        startedBy: { id: actor.id, name: 'Admin' },
        stoppedBy: null,
      });
      // 3 comments, one every 5 s: the last one is handled 10 s after the first
      expect(Date.parse(run.estimatedEndAt) - Date.parse(run.startedAt)).toBe(
        10_000,
      );
      expect(JSON.stringify(result)).not.toContain('admin@example.com');
      expect(run).not.toHaveProperty('clientName');
      expect(store.runs.get(run.id)).toMatchObject({ clientName: 'Acme' });
      await service.onModuleDestroy(); // stops the 5 s worker so the test ends
    });

    it('holds the post for the run, with a TTL longer than one pause plus a re-check', async () => {
      env.COMMENT_BACKFILL_DELAY_MS = '5000';
      unreplied([comment('a')]);
      await start();
      expect(store.acquireLock).toHaveBeenCalledWith(
        'facebook',
        POST,
        expect.any(String),
        65_000,
      );
      await service.onModuleDestroy();
    });
  });

  // ─────────────────────────── the worker ───────────────────────────

  describe('worker', () => {
    it('queues the comments in the order given and ends the run as finished', async () => {
      unreplied([comment('new'), comment('old')]);

      const { run } = await start();
      await flush();

      expect(pushed().map((i) => i.id)).toEqual(['new', 'old']);
      expect(store.only()).toMatchObject({
        id: run?.id,
        state: 'finished',
        interruptReason: null,
        queued: 2,
        dropped: 0,
        skipped: 0,
        handled: 2,
      });
      expect(store.locks.size).toBe(0);
    });

    it('pushes the same item shape as the live webhook, without the rate limit', async () => {
      unreplied([comment('old', { text: 'بكام', senderId: 'u1' })]);

      await start();
      await flush();

      const [item, opts] = inbox.push.mock.calls[0];
      expect(item).toMatchObject({
        kind: 'comment',
        platform: 'facebook',
        id: 'old',
        accountId: PAGE,
        senderId: 'u1',
        text: 'بكام',
        postId: POST,
      });
      expect(opts).toEqual({ skipRateLimit: true });
    });

    it('counts a comment the inbox refuses (duplicate or blocked sender) as dropped, still handled', async () => {
      unreplied([comment('a'), comment('b'), comment('c')]);
      inbox.push
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await start();
      await flush();

      expect(store.only()).toMatchObject({
        queued: 2,
        dropped: 1,
        handled: 3,
        state: 'finished',
      });
    });

    it.each<RecheckOutcome>(['answered', 'hidden', 'deleted', 'check_failed'])(
      'skips a comment whose re-check says %s: counted as handled, never pushed',
      async (outcome) => {
        unreplied([comment('a'), comment('b')]);
        postComments.recheck
          .mockResolvedValueOnce(outcome)
          .mockResolvedValueOnce('needs_reply');

        await start();
        await flush();

        expect(pushed().map((i) => i.id)).toEqual(['b']);
        expect(store.only()).toMatchObject({
          skipped: 1,
          queued: 1,
          handled: 2,
          state: 'finished',
        });
      },
    );

    it('re-checks each comment with the right platform, account and token, just before pushing it', async () => {
      unreplied([comment('a')]);
      postComments.recheck.mockImplementation(() => {
        expect(inbox.push).not.toHaveBeenCalled(); // the check comes first
        return Promise.resolve('needs_reply');
      });

      await start(IG, '444444');
      await flush();

      expect(postComments.recheck).toHaveBeenCalledWith(
        'instagram',
        IG,
        'a',
        AUTH,
      );
    });

    it('renews the lock before every comment', async () => {
      unreplied([comment('a'), comment('b')]);
      await start();
      await flush();
      expect(store.renewLock).toHaveBeenCalledTimes(2);
    });

    describe('stopping and interruption', () => {
      it('stops before the next comment when the run was stopped, even on another instance', async () => {
        env.COMMENT_BACKFILL_DELAY_MS = '10';
        unreplied([comment('a'), comment('b'), comment('c')]);
        // stopped "elsewhere" while the first comment is being handled
        inbox.push.mockImplementationOnce(() => {
          const run = store.only();
          void store.stop(run, other, 86_400);
          return Promise.resolve(true);
        });

        await start();
        await new Promise((r) => setTimeout(r, 120));

        expect(pushed().map((i) => i.id)).toEqual(['a']); // at most the one in flight
        expect(store.only()).toMatchObject({
          state: 'stopped',
          stoppedBy: { id: other.id, name: 'Other admin' },
          handled: 1,
        });
        expect(store.end).not.toHaveBeenCalled(); // a stopped run is not "finished"
      });

      it('exits on the run state alone: a run no longer running ends the worker even while it still holds the lock', async () => {
        env.COMMENT_BACKFILL_DELAY_MS = '10';
        unreplied([comment('a'), comment('b'), comment('c')]);
        inbox.push.mockImplementationOnce(() => {
          // the state changes but the lock is left in place: only the state check can stop the worker
          store.runs.get(store.only().id)!.state = 'stopped';
          return Promise.resolve(true);
        });

        await start();
        await new Promise((r) => setTimeout(r, 120));

        expect(pushed().map((i) => i.id)).toEqual(['a']);
        expect(store.locks.size).toBe(1);
      });

      it('exits on the shutdown flag alone, even if the run could not be marked interrupted', async () => {
        env.COMMENT_BACKFILL_DELAY_MS = '30';
        unreplied(['a', 'b', 'c'].map((id) => comment(id)));
        await start();
        await flush(); // 'a' is pushed; the worker is now waiting out the pause
        store.end.mockResolvedValue(true); // Redis is going away: the run state is not changed

        await service.onModuleDestroy();
        await new Promise((r) => setTimeout(r, 100));

        expect(inbox.push).toHaveBeenCalledTimes(1);
        expect(store.only().state).toBe('running'); // only the lock expiring will report it
      });

      it('ends as interrupted when comment replies are turned off mid-run', async () => {
        unreplied([comment('a'), comment('b'), comment('c')]);
        clients.findById
          .mockResolvedValueOnce(config())
          .mockResolvedValue(
            config({ commentReplyConfig: { enabled: false } }),
          );

        await start();
        await flush();

        expect(pushed().map((i) => i.id)).toEqual(['a']);
        expect(store.only()).toMatchObject({
          state: 'interrupted',
          interruptReason: 'COMMENT_REPLIES_DISABLED',
          handled: 1,
        });
        expect(store.locks.size).toBe(0);
      });

      it('ends as interrupted when the client was deleted', async () => {
        unreplied([comment('a'), comment('b')]);
        clients.findById.mockRejectedValue(new NotFoundException());

        await start();
        await flush();

        expect(inbox.push).not.toHaveBeenCalled();
        expect(store.only()).toMatchObject({
          state: 'interrupted',
          interruptReason: 'ACCOUNT_DISCONNECTED',
        });
      });

      it('ends as interrupted when the account was removed from the client', async () => {
        unreplied([comment('a')]);
        clients.findById.mockResolvedValue(config({ fbPageId: '99999999999' }));

        await start();
        await flush();

        expect(store.only()).toMatchObject({
          state: 'interrupted',
          interruptReason: 'ACCOUNT_DISCONNECTED',
        });
      });

      it.each([190, 10, 200])(
        'ends as interrupted META_ACCESS_LOST when the token is rejected (code %i), without checking further comments',
        async (code) => {
          unreplied([comment('a'), comment('b')]);
          postComments.recheck.mockRejectedValue(
            new GraphError('x', false, code),
          );

          await start();
          await flush();

          expect(postComments.recheck).toHaveBeenCalledTimes(1);
          expect(inbox.push).not.toHaveBeenCalled();
          expect(store.only()).toMatchObject({
            state: 'interrupted',
            interruptReason: 'META_ACCESS_LOST',
          });
        },
      );

      it('exits without ending the run when it lost the lock: stale detection reports it', async () => {
        unreplied([comment('a'), comment('b')]);
        store.renewLock.mockResolvedValue(false);

        await start();
        await flush();

        expect(inbox.push).not.toHaveBeenCalled();
        expect(store.end).not.toHaveBeenCalled();
      });

      it('stops feeding when the app shuts down, and marks its runs interrupted', async () => {
        env.COMMENT_BACKFILL_DELAY_MS = '30';
        unreplied(['a', 'b', 'c'].map((id) => comment(id)));

        await start();
        await flush();
        await service.onModuleDestroy();
        await new Promise((r) => setTimeout(r, 100));

        expect(inbox.push).toHaveBeenCalledTimes(1);
        expect(store.only()).toMatchObject({
          state: 'interrupted',
          interruptReason: 'SERVER_RESTART',
        });
      });

      it('shuts down cleanly even if Redis is already gone', async () => {
        env.COMMENT_BACKFILL_DELAY_MS = '30';
        unreplied([comment('a'), comment('b')]);
        await start();
        store.end.mockRejectedValue(new Error('Connection is closed'));

        await expect(service.onModuleDestroy()).resolves.toBeUndefined();
      });
    });

    describe('errors never escape the background worker', () => {
      let unhandled: unknown[];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      beforeEach(() => {
        unhandled = [];
        process.on('unhandledRejection', onUnhandled);
      });
      afterEach(() => {
        process.off('unhandledRejection', onUnhandled);
      });

      it('skips a comment that fails unexpectedly and goes on with the next', async () => {
        unreplied([comment('a'), comment('b')]);
        postComments.recheck
          .mockRejectedValueOnce(new TypeError('bug'))
          .mockResolvedValueOnce('needs_reply');

        await start();
        await flush();

        expect(pushed().map((i) => i.id)).toEqual(['b']);
        expect(store.only()).toMatchObject({
          skipped: 1,
          queued: 1,
          state: 'finished',
        });
        expect(unhandled).toEqual([]);
      });

      it('survives Redis failing while it runs', async () => {
        unreplied([comment('a'), comment('b')]);
        store.get.mockRejectedValue(new Error('redis down'));
        store.incr.mockRejectedValue(new Error('redis down'));
        store.end.mockRejectedValue(new Error('redis down'));

        await expect(start()).resolves.toMatchObject({ pending: 2 });
        await flush();

        expect(unhandled).toEqual([]);
      });
    });
  });

  // ─────────────────────────── reading and stopping a run ───────────────────────────

  describe('getRun', () => {
    it('404 BACKFILL_RUN_NOT_FOUND for an unknown or expired run', async () => {
      const thrown = await service.getRun('missing').catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect((thrown as NotFoundException).getResponse()).toMatchObject({
        errorCode: 'BACKFILL_RUN_NOT_FOUND',
      });
    });

    it('returns the run without its internal client name', async () => {
      unreplied([comment('a')]);
      const { run } = await start();
      await flush();

      const read = await service.getRun(run!.id);

      expect(read).toMatchObject({
        id: run!.id,
        state: 'finished',
        handled: 1,
      });
      expect(read).not.toHaveProperty('clientName');
    });

    it('reports a running run whose lock was lost as interrupted by a restart', async () => {
      unreplied([comment('a'), comment('b')]);
      env.COMMENT_BACKFILL_DELAY_MS = '5000';
      const { run } = await start();
      await service.onModuleDestroy(); // the worker is gone...
      store.runs.get(run!.id)!.state = 'running'; // ...but the run still says running
      store.locks.clear(); // and its lock expired

      const read = await service.getRun(run!.id);

      expect(read).toMatchObject({
        state: 'interrupted',
        interruptReason: 'SERVER_RESTART',
      });
    });

    it('does not look for a stale lock on a run that already ended', async () => {
      unreplied([comment('a')]);
      const { run } = await start();
      await flush();
      store.markStaleIfLockLost.mockClear();

      await service.getRun(run!.id);

      expect(store.markStaleIfLockLost).not.toHaveBeenCalled();
    });
  });

  describe('stopRun', () => {
    const running = async () => {
      env.COMMENT_BACKFILL_DELAY_MS = '5000';
      unreplied([comment('a'), comment('b'), comment('c')]);
      const { run } = await start();
      await flush();
      return run!;
    };

    it('stops the run, records who stopped it and how many were handled, and frees the post', async () => {
      const run = await running(); // 'a' handled, 'b' and 'c' waiting
      clients.recordReplyRun.mockClear();

      const stopped = await service.stopRun(run.id, other);

      expect(stopped).toMatchObject({
        id: run.id,
        state: 'stopped',
        stoppedBy: { id: other.id, name: 'Other admin' },
        handled: 1,
      });
      expect(stopped).not.toHaveProperty('clientName');
      expect(clients.recordReplyRun).toHaveBeenCalledWith(
        { id: CLIENT_ID, name: 'Acme' },
        'REPLY_RUN_STOPPED',
        other,
        {
          runId: run.id,
          platform: 'facebook',
          accountId: PAGE,
          postId: POST,
          toAnswer: 3,
          handled: 1,
        },
      );
      expect(store.locks.size).toBe(0);
      await service.onModuleDestroy();
    });

    it('lets a new run start on the post right after a stop', async () => {
      const run = await running();
      await service.stopRun(run.id, other);

      unreplied([comment('d')]);
      env.COMMENT_BACKFILL_DELAY_MS = '0';
      await expect(start()).resolves.toMatchObject({ pending: 1 });
      await service.onModuleDestroy();
    });

    it('409 BACKFILL_RUN_ENDED naming the final state when the run had already ended, recording nothing', async () => {
      unreplied([comment('a')]);
      const { run } = await start();
      await flush();
      clients.recordReplyRun.mockClear();

      const thrown = await service
        .stopRun(run!.id, other)
        .catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).getResponse()).toMatchObject({
        errorCode: 'BACKFILL_RUN_ENDED',
        details: { state: 'finished' },
      });
      expect(clients.recordReplyRun).not.toHaveBeenCalled();
    });

    it('404 BACKFILL_RUN_NOT_FOUND for an unknown run', async () => {
      const thrown = await service
        .stopRun('missing', other)
        .catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect((thrown as NotFoundException).getResponse()).toMatchObject({
        errorCode: 'BACKFILL_RUN_NOT_FOUND',
      });
    });

    it('keeps the run stopped but fails loudly when the stop cannot be recorded', async () => {
      const run = await running();
      clients.recordReplyRun.mockRejectedValue(new Error('db down'));

      await expect(service.stopRun(run.id, other)).rejects.toThrow('db down');

      expect(store.runs.get(run.id)?.state).toBe('stopped'); // stopping is the safe direction
      await service.onModuleDestroy();
    });

    it('records the stop under the stored client name even if the client was deleted', async () => {
      const run = await running();
      clients.findById.mockRejectedValue(new NotFoundException());
      clients.getClientDataForWorkFlow.mockResolvedValue(null);
      clients.recordReplyRun.mockClear();

      await service.stopRun(run.id, other);

      expect(clients.recordReplyRun).toHaveBeenCalledWith(
        { id: CLIENT_ID, name: 'Acme' },
        'REPLY_RUN_STOPPED',
        other,
        expect.objectContaining({ runId: run.id }),
      );
      await service.onModuleDestroy();
    });
  });

  describe('latestRuns', () => {
    it('returns each post’s latest run, without the client name', async () => {
      unreplied([comment('a')]);
      const { run } = await start();
      await flush();

      const found = await service.latestRuns('facebook', [POST, 'other-post']);

      expect([...found.keys()]).toEqual([POST]);
      expect(found.get(POST)).toMatchObject({ id: run!.id });
      expect(found.get(POST)).not.toHaveProperty('clientName');
    });

    it('marks a running run with a lost lock as interrupted', async () => {
      unreplied([comment('a'), comment('b')]);
      env.COMMENT_BACKFILL_DELAY_MS = '5000';
      const { run } = await start();
      await service.onModuleDestroy();
      store.runs.get(run!.id)!.state = 'running';
      store.locks.clear();

      const found = await service.latestRuns('facebook', [POST]);

      expect(found.get(POST)).toMatchObject({
        state: 'interrupted',
        interruptReason: 'SERVER_RESTART',
      });
    });

    it('returns nothing for no posts', async () => {
      const found = await service.latestRuns('facebook', []);
      expect(found.size).toBe(0);
    });
  });

  describe('configuration', () => {
    it('keeps an ended run visible for COMMENT_BACKFILL_RESULT_TTL_SEC, 24 h by default', async () => {
      unreplied([comment('a')]);
      await start();
      await flush();
      expect(store.end).toHaveBeenCalledWith(
        expect.anything(),
        'finished',
        null,
        86_400,
      );

      env.COMMENT_BACKFILL_RESULT_TTL_SEC = '600';
      unreplied([comment('b')]);
      await start();
      await flush();
      expect(store.end).toHaveBeenLastCalledWith(
        expect.anything(),
        'finished',
        null,
        600,
      );
    });

    it('never uses a TTL of 0, which would delete the run at once', async () => {
      env.COMMENT_BACKFILL_RESULT_TTL_SEC = '0';
      unreplied([comment('a')]);
      await start();
      await flush();
      expect(store.end).toHaveBeenCalledWith(
        expect.anything(),
        'finished',
        null,
        86_400,
      );
    });
  });
});
