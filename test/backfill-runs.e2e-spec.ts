// A short pause, so a run of 3 comments takes about 400 ms. ConfigService reads it live, and
// the tests that need a slower run change it before starting one.
process.env.COMMENT_BACKFILL_DELAY_MS = '200';

import { INestApplication } from '@nestjs/common';
import type { Redis } from 'ioredis';
import request = require('supertest');
import { InboxItem } from '../src/inbox/inbox.types';
import { PriorityInboxService } from '../src/inbox/priority-inbox.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS } from '../src/redis/redis.constants';
import {
  bearer,
  createE2eApp,
  createUser,
  flushLoginFailures,
  login,
  resetDb,
} from './utils/e2e-app';
import {
  graphCalls,
  graphError,
  GraphReply,
  restoreGraph,
  stubGraph,
} from './utils/graph-stub';

const PAGE = '114022207011543';
const PAGE_REPLIES_OFF = '114022207099999';
const POST = `${PAGE}_100068101366873`;

interface Run {
  id: string;
  state: string;
  interruptReason: string | null;
  toAnswer: number;
  handled: number;
  queued: number;
  dropped: number;
  skipped: number;
  startedBy: { id: string; name: string };
  stoppedBy: { id: string; name: string } | null;
}
interface StartBody {
  pending: number;
  total: number;
  delaySeconds: number;
  run: Run | null;
  errorCode?: string;
  details?: { runId?: string; state?: string };
}

const REPLIES_ON = {
  enabled: true,
  likes_enabled: false,
  inquiry_can_dm: [],
  inquiry_can_not_dm: [],
  engagement: [],
};

describe('Backfill reply runs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: Redis;
  let adminToken: string;
  let clientUserToken: string;
  let clientId: string;
  /** What the runs pushed to the inbox. `push` is replaced, so nothing is queued, classified or sent. */
  let pushed: InboxItem[];
  let pushSpy: jest.SpyInstance;
  let blockedSenders: Set<string>;

  /** Three customer comments the page has not answered. */
  const customers = ['c1', 'c2', 'c3'].map((id, i) => ({
    id,
    message: `comment ${id}`,
    created_time: `2026-03-0${3 - i}T10:00:00+0000`, // c1 is the newest
    from: { id: `customer-${id}` },
  }));
  /** Per-comment answers of the re-check call; a comment not listed still needs a reply. */
  let recheck: Record<string, GraphReply>;
  let comments: unknown[];

  const stubMeta = () =>
    stubGraph((url) => {
      if (url.pathname.endsWith(`/${POST}/comments`)) {
        return { body: { data: comments } };
      }
      if (url.pathname.endsWith(`/${PAGE}/posts`)) {
        return {
          body: {
            data: [
              {
                id: POST,
                message: 'عرض الصيف',
                created_time: '2026-03-01T10:00:00+0000',
                permalink_url: `https://www.facebook.com/${PAGE}/posts/1`,
                comments: { data: [], summary: { total_count: 3 } },
              },
            ],
          },
        };
      }
      const one = /\/v24\.0\/([^/]+)$/.exec(url.pathname);
      if (one) return recheck[one[1]] ?? { body: { id: one[1] } };
      return undefined;
    });

  const start = (
    body: { accountId: string; postId: string } = {
      accountId: PAGE,
      postId: POST,
    },
    token = adminToken,
  ) =>
    request(app.getHttpServer())
      .post('/inbox/comments/backfill')
      .set(bearer(token))
      .send(body);
  const getRun = (id: string, token = adminToken) =>
    request(app.getHttpServer())
      .get(`/inbox/comments/backfill/runs/${id}`)
      .set(bearer(token));
  const stop = (id: string, token = adminToken) =>
    request(app.getHttpServer())
      .post(`/inbox/comments/backfill/runs/${id}/stop`)
      .set(bearer(token));

  /** Polls a run until `done` is true, and returns every state it saw. */
  const watch = async (id: string, done: (r: Run) => boolean, ms = 8000) => {
    const seen: Run[] = [];
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const res = await getRun(id).expect(200);
      const run = res.body as Run;
      seen.push(run);
      if (done(run)) return seen;
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(
      `run ${id} did not get there: ${JSON.stringify(seen.at(-1))}`,
    );
  };

  const pushedIds = () => pushed.map((i) => i.id);

  const clean = async () => {
    for (const pattern of ['backfill:*', 'inbox:*', 'blocked:*']) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    }
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    redis = app.get<Redis>(REDIS);
    // the real push would queue the comment for the dispatcher, which would classify it and call
    // Gemini and Meta. The inbox's own dedupe and blocklist are covered by its unit tests.
    pushSpy = jest.spyOn(app.get(PriorityInboxService), 'push');
    await resetDb(prisma);
    await flushLoginFailures(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    await createUser(prisma, 'client@e2e.test', ['CLIENT']);
    adminToken = (await login(app, 'admin@e2e.test')).token;
    clientUserToken = (await login(app, 'client@e2e.test')).token;

    const make = (fbPageId: string, commentReplyConfig: object) =>
      request(app.getHttpServer())
        .post('/clients')
        .set(bearer(adminToken))
        .send({
          name: `Client ${fbPageId}`,
          businessCategory: 'Cafe',
          fbPageId,
          accessToken: 'e2e-page-token',
          commentReplyConfig,
        })
        .expect(201);
    clientId = ((await make(PAGE, REPLIES_ON)).body as { id: string }).id;
    await make(PAGE_REPLIES_OFF, { ...REPLIES_ON, enabled: false });
  });

  beforeEach(async () => {
    await clean();
    await prisma.clientActivity.deleteMany({
      where: { action: { in: ['REPLY_RUN_STARTED', 'REPLY_RUN_STOPPED'] } },
    });
    await prisma.client.update({
      where: { id: clientId },
      data: { commentReplyConfig: REPLIES_ON }, // a failed test must not leave replies off
    });
    pushed = [];
    blockedSenders = new Set();
    pushSpy.mockReset();
    pushSpy.mockImplementation((item: InboxItem) => {
      pushed.push(item);
      return Promise.resolve(!blockedSenders.has(item.senderId ?? ''));
    });
    comments = customers;
    recheck = {};
    process.env.COMMENT_BACKFILL_DELAY_MS = '200';
    delete process.env.COMMENT_BACKFILL_RESULT_TTL_SEC;
    stubMeta();
  });

  afterEach(() => restoreGraph());

  afterAll(async () => {
    pushSpy.mockRestore();
    await clean();
    await app.close();
  });

  describe('access', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const calls = (token?: string) => [
      () =>
        token
          ? start(undefined, token)
          : request(app.getHttpServer())
              .post('/inbox/comments/backfill')
              .send({ accountId: PAGE, postId: POST }),
      () =>
        token
          ? getRun(id, token)
          : request(app.getHttpServer()).get(
              `/inbox/comments/backfill/runs/${id}`,
            ),
      () =>
        token
          ? stop(id, token)
          : request(app.getHttpServer()).post(
              `/inbox/comments/backfill/runs/${id}/stop`,
            ),
    ];

    it('returns 401 without a token', async () => {
      for (const call of calls()) await call().expect(401);
    });

    it('returns 403 FORBIDDEN for a CLIENT-role user, and starts nothing', async () => {
      for (const call of calls(clientUserToken)) {
        const res = await call().expect(403);
        expect((res.body as StartBody).errorCode).toBe('FORBIDDEN');
      }
      expect(graphCalls()).toHaveLength(0);
      expect(await redis.keys('backfill:*')).toEqual([]);
    });

    it('422s a run id that is not a UUID', async () => {
      await getRun('abc').expect(422);
      await stop('abc').expect(422);
    });

    it('404s an unknown run', async () => {
      const res = await getRun(id).expect(404);
      expect((res.body as StartBody).errorCode).toBe('BACKFILL_RUN_NOT_FOUND');
      await stop(id).expect(404);
    });
  });

  describe('starting', () => {
    it('409 COMMENT_REPLIES_DISABLED when the client has comment replies off, and starts nothing', async () => {
      const res = await start({
        accountId: PAGE_REPLIES_OFF,
        postId: `${PAGE_REPLIES_OFF}_100068101366873`,
      }).expect(409);

      expect((res.body as StartBody).errorCode).toBe(
        'COMMENT_REPLIES_DISABLED',
      );
      expect(graphCalls()).toHaveLength(0);
      expect(await redis.keys('backfill:*')).toEqual([]);
    });

    it('404s an account that no client owns', async () => {
      await start({
        accountId: '99999999999',
        postId: '99999999999_12345',
      }).expect(404);
    });

    it('answers 202 with the counts and the run to follow', async () => {
      const res = await start().expect(202);
      const body = res.body as StartBody;

      expect(body).toMatchObject({ pending: 3, total: 3, delaySeconds: 0.2 });
      expect(body.run).toMatchObject({
        state: 'running',
        toAnswer: 3,
        handled: 0,
        startedBy: { name: 'admin' },
        stoppedBy: null,
      });
      await watch(body.run!.id, (r) => r.state !== 'running');
    });

    it('lets only one of two parallel starts through, and names the run in progress', async () => {
      const [a, b] = await Promise.all([start(), start()]);
      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual([202, 409]);

      const won = (a.status === 202 ? a : b).body as StartBody;
      const lost = (a.status === 409 ? a : b).body as StartBody;
      expect(lost.errorCode).toBe('CONFLICT');
      expect(lost.details?.runId).toBe(won.run!.id);
      await watch(won.run!.id, (r) => r.state !== 'running');
    });

    it('answers 202 with run null and records nothing when every comment is answered', async () => {
      comments = customers.map((c) => ({
        ...c,
        comments: { data: [{ from: { id: PAGE } }] },
      }));

      const res = await start().expect(202);

      expect(res.body).toMatchObject({ pending: 0, total: 3, run: null });
      expect(await redis.keys('backfill:*')).toEqual([]);
      expect(
        await prisma.clientActivity.count({
          where: { action: 'REPLY_RUN_STARTED' },
        }),
      ).toBe(0);
    });

    it('frees the post after a Meta error, so it can be retried', async () => {
      stubGraph(() => graphError(190, 463));
      const res = await start().expect(400);
      expect((res.body as StartBody).errorCode).toBe('META_TOKEN_INVALID');
      expect(await redis.keys('backfill:lock:*')).toEqual([]);

      stubMeta();
      await start().expect(202);
    });
  });

  describe('progress', () => {
    it('shows handled going up to the number to answer, then finished, with the comments queued newest first', async () => {
      const started = (await start().expect(202)).body as StartBody;

      const seen = await watch(started.run!.id, (r) => r.state === 'finished');

      const handled = seen.map((r) => r.handled);
      expect(handled).toEqual([...handled].sort((x, y) => x - y)); // never goes down
      expect(seen.at(-1)).toMatchObject({
        state: 'finished',
        interruptReason: null,
        toAnswer: 3,
        handled: 3,
        queued: 3,
        dropped: 0,
        skipped: 0,
      });
      expect(pushedIds()).toEqual(['c1', 'c2', 'c3']); // newest first
      expect(pushSpy.mock.calls[0][1]).toEqual({ skipRateLimit: true });
      expect(await redis.keys('backfill:lock:*')).toEqual([]); // the post is free again
    });

    it('re-checks each comment: one answered by hand since the run started is skipped, not queued', async () => {
      recheck.c2 = {
        body: { id: 'c2', comments: { data: [{ from: { id: PAGE } }] } },
      };
      const started = (await start().expect(202)).body as StartBody;

      const seen = await watch(started.run!.id, (r) => r.state === 'finished');

      expect(seen.at(-1)).toMatchObject({ handled: 3, queued: 2, skipped: 1 });
      expect(pushedIds()).toEqual(['c1', 'c3']);
    });

    it('skips, rather than answers, a comment whose re-check fails', async () => {
      recheck.c3 = graphError(2, undefined, 500); // temporary, on every retry
      const started = (await start().expect(202)).body as StartBody;

      const seen = await watch(
        started.run!.id,
        (r) => r.state === 'finished',
        20000,
      );

      expect(seen.at(-1)).toMatchObject({ queued: 2, skipped: 1 });
      expect(pushedIds()).toEqual(['c1', 'c2']);
    }, 30000);

    it('counts a comment from a blocked sender as dropped, still handled', async () => {
      blockedSenders.add('customer-c2');
      const started = (await start().expect(202)).body as StartBody;

      const seen = await watch(started.run!.id, (r) => r.state === 'finished');

      expect(seen.at(-1)).toMatchObject({ handled: 3, queued: 2, dropped: 1 });
    });

    it('interrupts the run when the token is rejected, and says why', async () => {
      recheck.c1 = graphError(190, 463);
      const started = (await start().expect(202)).body as StartBody;

      const seen = await watch(started.run!.id, (r) => r.state !== 'running');

      expect(seen.at(-1)).toMatchObject({
        state: 'interrupted',
        interruptReason: 'META_ACCESS_LOST',
        handled: 0,
      });
      expect(pushed).toEqual([]);
      expect(await redis.keys('backfill:lock:*')).toEqual([]);
    });

    it('interrupts the run when comment replies are turned off during it', async () => {
      process.env.COMMENT_BACKFILL_DELAY_MS = '400';
      const started = (await start().expect(202)).body as StartBody;
      await watch(started.run!.id, (r) => r.handled >= 1);

      await prisma.client.update({
        where: { id: clientId },
        data: { commentReplyConfig: { ...REPLIES_ON, enabled: false } },
      });
      const seen = await watch(started.run!.id, (r) => r.state !== 'running');
      await prisma.client.update({
        where: { id: clientId },
        data: { commentReplyConfig: REPLIES_ON },
      });

      expect(seen.at(-1)).toMatchObject({
        state: 'interrupted',
        interruptReason: 'COMMENT_REPLIES_DISABLED',
      });
      expect(seen.at(-1)!.handled).toBeLessThan(3);
    });
  });

  describe('stopping', () => {
    it('stops a run: at most the comment in progress is completed, the post is freed, and a second stop says it ended', async () => {
      process.env.COMMENT_BACKFILL_DELAY_MS = '400';
      const started = (await start().expect(202)).body as StartBody;
      await watch(started.run!.id, (r) => r.handled >= 1);

      const stopped = await stop(started.run!.id).expect(200);

      expect(stopped.body).toMatchObject({
        id: started.run!.id,
        state: 'stopped',
        stoppedBy: { name: 'admin' },
      });
      const handledAtStop = (stopped.body as Run).handled;
      expect(await redis.keys('backfill:lock:*')).toEqual([]);

      await new Promise((r) => setTimeout(r, 1200)); // longer than two pauses
      const after = (await getRun(started.run!.id).expect(200)).body as Run;
      expect(after.state).toBe('stopped'); // never "finished"
      expect(after.handled - handledAtStop).toBeLessThanOrEqual(1);
      expect(pushed.length).toBeLessThan(3);

      const again = await stop(started.run!.id).expect(409);
      expect((again.body as StartBody).errorCode).toBe('BACKFILL_RUN_ENDED');
      expect((again.body as StartBody).details?.state).toBe('stopped');
    });

    it('lets a new run start on the post right after a stop', async () => {
      process.env.COMMENT_BACKFILL_DELAY_MS = '400';
      const first = (await start().expect(202)).body as StartBody;
      await stop(first.run!.id).expect(200);

      process.env.COMMENT_BACKFILL_DELAY_MS = '200';
      const second = await start().expect(202);

      expect((second.body as StartBody).run!.id).not.toBe(first.run!.id);
    });

    it('stops a run that already finished with 409 and changes nothing', async () => {
      const started = (await start().expect(202)).body as StartBody;
      await watch(started.run!.id, (r) => r.state === 'finished');

      const res = await stop(started.run!.id).expect(409);

      expect((res.body as StartBody).details?.state).toBe('finished');
      expect(
        await prisma.clientActivity.count({
          where: { action: 'REPLY_RUN_STOPPED' },
        }),
      ).toBe(0);
    });
  });

  describe('the result of a run, on the post (US3)', () => {
    const postsList = async () =>
      (
        await request(app.getHttpServer())
          .get(`/clients/${clientId}/posts?platform=facebook`)
          .set(bearer(adminToken))
          .expect(200)
      ).body as { data: { id: string; replyRun: Run | null }[] };

    it('shows a run in progress on its post, to every admin', async () => {
      process.env.COMMENT_BACKFILL_DELAY_MS = '400';
      const started = (await start().expect(202)).body as StartBody;

      const { data } = await postsList();

      expect(data[0]).toMatchObject({
        id: POST,
        replyRun: { id: started.run!.id, state: 'running', toAnswer: 3 },
      });
      await stop(started.run!.id).expect(200);
    });

    it('keeps a finished run on its post with the handled counts, and says some comments may be left on purpose', async () => {
      blockedSenders.add('customer-c2'); // left unanswered on purpose
      const started = (await start().expect(202)).body as StartBody;
      await watch(started.run!.id, (r) => r.state === 'finished');

      const { data } = await postsList();

      expect(data[0].replyRun).toMatchObject({
        id: started.run!.id,
        state: 'finished',
        interruptReason: null,
        toAnswer: 3,
        handled: 3,
        queued: 2,
        dropped: 1, // the dashboard words this as "some comments may be left unanswered on purpose"
      });
    });

    it('keeps a stopped run, and an interrupted one with its reason', async () => {
      process.env.COMMENT_BACKFILL_DELAY_MS = '400';
      const first = (await start().expect(202)).body as StartBody;
      await stop(first.run!.id).expect(200);
      expect((await postsList()).data[0].replyRun).toMatchObject({
        id: first.run!.id,
        state: 'stopped',
        stoppedBy: { name: 'admin' },
      });

      process.env.COMMENT_BACKFILL_DELAY_MS = '200';
      recheck.c1 = graphError(190, 463);
      const second = (await start().expect(202)).body as StartBody;
      await watch(second.run!.id, (r) => r.state !== 'running');

      // a new run replaces the old one as the post's latest
      expect((await postsList()).data[0].replyRun).toMatchObject({
        id: second.run!.id,
        state: 'interrupted',
        interruptReason: 'META_ACCESS_LOST',
      });
    });

    it('forgets an ended run after COMMENT_BACKFILL_RESULT_TTL_SEC', async () => {
      process.env.COMMENT_BACKFILL_RESULT_TTL_SEC = '3';
      const started = (await start().expect(202)).body as StartBody;
      await watch(started.run!.id, (r) => r.state === 'finished');
      expect((await postsList()).data[0].replyRun?.id).toBe(started.run!.id);

      await new Promise((r) => setTimeout(r, 3500));

      const res = await getRun(started.run!.id).expect(404);
      expect((res.body as StartBody).errorCode).toBe('BACKFILL_RUN_NOT_FOUND');
      expect((await postsList()).data[0].replyRun).toBeNull();
    }, 20000);
  });

  describe('a run whose server died', () => {
    it('is reported as interrupted by a restart once its lock is gone', async () => {
      process.env.COMMENT_BACKFILL_DELAY_MS = '5000';
      const started = (await start().expect(202)).body as StartBody;
      await watch(started.run!.id, (r) => r.handled >= 1);

      // what a dead process leaves behind: the run says running, the lock has expired
      await redis.del(`backfill:lock:facebook:${POST}`);
      const res = await getRun(started.run!.id).expect(200);

      expect(res.body).toMatchObject({
        state: 'interrupted',
        interruptReason: 'SERVER_RESTART',
      });
    });
  });

  describe('activity record (FR-019)', () => {
    it('records the start and the stop with the admin and ids only', async () => {
      process.env.COMMENT_BACKFILL_DELAY_MS = '400';
      const started = (await start().expect(202)).body as StartBody;
      await watch(started.run!.id, (r) => r.handled >= 1);
      const stopped = (await stop(started.run!.id).expect(200)).body as Run;

      const rows = await prisma.clientActivity.findMany({
        where: { action: { in: ['REPLY_RUN_STARTED', 'REPLY_RUN_STOPPED'] } },
        orderBy: { createdAt: 'asc' },
      });

      expect(rows.map((r) => r.action)).toEqual([
        'REPLY_RUN_STARTED',
        'REPLY_RUN_STOPPED',
      ]);
      expect(rows[0]).toMatchObject({
        clientId,
        actorName: 'admin',
        actorEmail: 'admin@e2e.test',
        changedFields: [],
        details: {
          runId: started.run!.id,
          platform: 'facebook',
          accountId: PAGE,
          postId: POST,
          toAnswer: 3,
        },
      });
      expect(rows[1].details).toMatchObject({
        runId: started.run!.id,
        toAnswer: 3,
        handled: stopped.handled,
      });
    });

    it('keeps no token, email or comment text in Redis, in responses or in the record', async () => {
      const started = (await start().expect(202)).body as StartBody;
      await watch(started.run!.id, (r) => r.state === 'finished');

      const hash = JSON.stringify(
        await redis.hgetall(`backfill:run:${started.run!.id}`),
      );
      const record = JSON.stringify(
        await prisma.clientActivity.findMany({
          where: { action: 'REPLY_RUN_STARTED' },
        }),
      );
      const response = JSON.stringify(started);

      for (const text of [hash, response]) {
        expect(text).not.toContain('e2e-page-token');
        expect(text).not.toContain('admin@e2e.test');
        expect(text).not.toContain('comment c1');
      }
      expect(record).not.toContain('e2e-page-token');
      expect(record).not.toContain('comment c1');
    });
  });
});
