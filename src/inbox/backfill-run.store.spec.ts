import { Redis } from 'ioredis';
import { BACKFILL_LOCK, BACKFILL_POST, BACKFILL_RUN } from './inbox.constants';
import { BackfillRunStore, StoredRun } from './backfill-run.store';

const RUN_ID = '3f0e1c2a-8a43-4c55-9b55-0d7b0c7b1e11';
const POST = '114022207011543_100068101366873';
const ref = { id: RUN_ID, platform: 'facebook' as const, postId: POST };
const runKey = `${BACKFILL_RUN}${RUN_ID}`;
const lockKey = `${BACKFILL_LOCK}facebook:${POST}`;
const postKey = `${BACKFILL_POST}facebook:${POST}`;
const actor = { id: 'a1111111-1111-4111-8111-111111111111', name: 'Admin' };

const run = (over: Partial<StoredRun> = {}): StoredRun => ({
  id: RUN_ID,
  clientId: 'c1111111-1111-4111-8111-111111111111',
  clientName: 'Acme',
  accountId: '114022207011543',
  platform: 'facebook',
  postId: POST,
  state: 'running',
  interruptReason: null,
  total: 12,
  toAnswer: 8,
  handled: 0,
  queued: 0,
  dropped: 0,
  skipped: 0,
  delaySeconds: 5,
  startedAt: '2026-11-09T10:00:00.000Z',
  estimatedEndAt: '2026-11-09T10:00:35.000Z',
  endedAt: null,
  startedBy: actor,
  stoppedBy: null,
  ...over,
});

describe('BackfillRunStore', () => {
  let store: BackfillRunStore;
  let redis: {
    set: jest.Mock;
    get: jest.Mock;
    hgetall: jest.Mock;
    hincrby: jest.Mock;
    eval: jest.Mock;
    multi: jest.Mock;
    pipeline: jest.Mock;
  };

  beforeEach(() => {
    redis = {
      set: jest.fn(),
      get: jest.fn(),
      hgetall: jest.fn(),
      hincrby: jest.fn().mockResolvedValue(1),
      eval: jest.fn(),
      multi: jest.fn(),
      pipeline: jest.fn(),
    };
    store = new BackfillRunStore(redis as unknown as Redis);
  });

  describe('lock', () => {
    it('is taken with SET NX PX, so only one of two parallel starts gets it', async () => {
      redis.set.mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

      await expect(
        store.acquireLock('facebook', POST, RUN_ID, 65_000),
      ).resolves.toBe(true);
      await expect(
        store.acquireLock('facebook', POST, 'other-run', 65_000),
      ).resolves.toBe(false);
      expect(redis.set).toHaveBeenNthCalledWith(
        1,
        lockKey,
        RUN_ID,
        'PX',
        65_000,
        'NX',
      );
    });

    it('is per platform and post', async () => {
      redis.set.mockResolvedValue('OK');
      await store.acquireLock('instagram', '17900000000000001', RUN_ID, 1000);
      expect(redis.set.mock.calls[0][0]).toBe(
        `${BACKFILL_LOCK}instagram:17900000000000001`,
      );
    });

    it('says who holds it, or null', async () => {
      redis.get.mockResolvedValueOnce(RUN_ID).mockResolvedValueOnce(null);
      await expect(store.lockHolder('facebook', POST)).resolves.toBe(RUN_ID);
      await expect(store.lockHolder('facebook', POST)).resolves.toBeNull();
      expect(redis.get).toHaveBeenCalledWith(lockKey);
    });

    it('is renewed only by its holder (compare-and-set in Lua)', async () => {
      redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(store.renewLock(ref, 65_000)).resolves.toBe(true);
      await expect(store.renewLock(ref, 65_000)).resolves.toBe(false);

      const [script, numKeys, key, id, ttl] = redis.eval.mock.calls[0] as [
        string,
        number,
        string,
        string,
        number,
      ];
      expect(script).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
      expect(script).toContain('PEXPIRE');
      expect([numKeys, key, id, ttl]).toEqual([1, lockKey, RUN_ID, 65_000]);
    });

    it('is released only by its holder, so a late worker never frees a newer run', async () => {
      redis.eval.mockResolvedValue(1);

      await store.releaseLock(ref);

      const [script, numKeys, key, id] = redis.eval.mock.calls[0] as [
        string,
        number,
        string,
        string,
      ];
      expect(script).toContain("redis.call('GET', KEYS[1]) == ARGV[1]");
      expect(script).toContain("redis.call('DEL', KEYS[1])");
      expect([numKeys, key, id]).toEqual([1, lockKey, RUN_ID]);
    });
  });

  describe('create', () => {
    it('writes the run as a hash, with the 48 h running TTL on it and on the post pointer', async () => {
      const chain = {
        hset: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      redis.multi.mockReturnValue(chain);

      await store.create(run());

      expect(chain.hset).toHaveBeenCalledWith(
        runKey,
        expect.objectContaining({
          id: RUN_ID,
          clientName: 'Acme',
          platform: 'facebook',
          postId: POST,
          state: 'running',
          interruptReason: '',
          total: '12',
          toAnswer: '8',
          queued: '0',
          dropped: '0',
          skipped: '0',
          delaySeconds: '5',
          endedAt: '',
          startedById: actor.id,
          startedByName: 'Admin',
          stoppedById: '',
          stoppedByName: '',
        }),
      );
      expect(chain.expire).toHaveBeenCalledWith(runKey, 48 * 3600);
      expect(chain.set).toHaveBeenCalledWith(postKey, RUN_ID, 'EX', 48 * 3600);
      expect(chain.exec).toHaveBeenCalled();
    });

    it('never stores a token or an email', async () => {
      const chain = {
        hset: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      redis.multi.mockReturnValue(chain);

      await store.create(run());

      const fields = Object.keys(
        (chain.hset.mock.calls[0] as [string, Record<string, string>])[1],
      );
      expect(fields.filter((f) => /token|email/i.test(f))).toEqual([]);
    });
  });

  describe('get', () => {
    const hash = (over: Record<string, string> = {}) => ({
      id: RUN_ID,
      clientId: 'c1111111-1111-4111-8111-111111111111',
      clientName: 'Acme',
      accountId: '114022207011543',
      platform: 'facebook',
      postId: POST,
      state: 'running',
      interruptReason: '',
      total: '12',
      toAnswer: '8',
      queued: '2',
      dropped: '1',
      skipped: '3',
      delaySeconds: '5',
      startedAt: '2026-11-09T10:00:00.000Z',
      estimatedEndAt: '2026-11-09T10:00:35.000Z',
      endedAt: '',
      startedById: actor.id,
      startedByName: 'Admin',
      stoppedById: '',
      stoppedByName: '',
      ...over,
    });

    it('maps the hash back, with handled = queued + dropped + skipped', async () => {
      redis.hgetall.mockResolvedValue(hash());

      const found = await store.get(RUN_ID);

      expect(redis.hgetall).toHaveBeenCalledWith(runKey);
      expect(found).toEqual(
        run({ queued: 2, dropped: 1, skipped: 3, handled: 6 }),
      );
    });

    it('reads an ended run: reason, end time and who stopped it', async () => {
      redis.hgetall.mockResolvedValue(
        hash({
          state: 'stopped',
          endedAt: '2026-11-09T10:00:20.000Z',
          stoppedById: 'b2222222-2222-4222-8222-222222222222',
          stoppedByName: 'Other admin',
        }),
      );
      expect(await store.get(RUN_ID)).toMatchObject({
        state: 'stopped',
        interruptReason: null,
        endedAt: '2026-11-09T10:00:20.000Z',
        stoppedBy: {
          id: 'b2222222-2222-4222-8222-222222222222',
          name: 'Other admin',
        },
      });

      redis.hgetall.mockResolvedValue(
        hash({ state: 'interrupted', interruptReason: 'SERVER_RESTART' }),
      );
      expect(await store.get(RUN_ID)).toMatchObject({
        state: 'interrupted',
        interruptReason: 'SERVER_RESTART',
        stoppedBy: null,
      });
    });

    it('is null for a run that does not exist or has expired', async () => {
      redis.hgetall.mockResolvedValue({});
      await expect(store.get(RUN_ID)).resolves.toBeNull();
    });
  });

  it('counts one handled comment with HINCRBY on the right counter', async () => {
    await store.incr(RUN_ID, 'skipped');
    expect(redis.hincrby).toHaveBeenCalledWith(runKey, 'skipped', 1);
  });

  describe('ending a run', () => {
    it('stop: changes running → stopped in one Lua call and returns the previous state', async () => {
      redis.eval.mockResolvedValue('running');

      const previous = await store.stop(ref, actor, 86_400);

      expect(previous).toBe('running');
      const args = redis.eval.mock.calls[0] as unknown[];
      const script = args[0] as string;
      expect(script).toContain("'stopped'");
      expect(script).toContain("redis.call('GET', KEYS[2]) == ARGV[5]"); // lock only if still ours
      expect(args.slice(1, 6)).toEqual([3, runKey, lockKey, postKey, actor.id]);
      expect(args[6]).toBe(actor.name);
      expect(Number.isNaN(Date.parse(args[7] as string))).toBe(false); // endedAt
      expect(args.slice(8)).toEqual(['86400', RUN_ID]);
    });

    it('stop: returns the final state of a run that had already ended', async () => {
      redis.eval.mockResolvedValue('finished');
      await expect(store.stop(ref, actor, 86_400)).resolves.toBe('finished');
    });

    it('stop: returns null when the run does not exist', async () => {
      redis.eval.mockResolvedValue(null);
      await expect(store.stop(ref, actor, 86_400)).resolves.toBeNull();
    });

    it('end: moves running to finished or interrupted only, and says whether it did', async () => {
      redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(
        store.end(ref, 'interrupted', 'COMMENT_REPLIES_DISABLED', 86_400),
      ).resolves.toBe(true);
      await expect(store.end(ref, 'finished', null, 86_400)).resolves.toBe(
        false,
      );

      const first = redis.eval.mock.calls[0] as unknown[];
      expect(first[0]).toContain("~= 'running'");
      expect(first.slice(1, 5)).toEqual([3, runKey, lockKey, postKey]);
      expect(first[5]).toBe('interrupted');
      expect(first[6]).toBe('COMMENT_REPLIES_DISABLED');
      const second = redis.eval.mock.calls[1] as unknown[];
      expect(second[5]).toBe('finished');
      expect(second[6]).toBe(''); // no reason
    });

    it('markStaleIfLockLost: interrupts a running run whose lock is gone or another run’s', async () => {
      redis.eval.mockResolvedValueOnce(1).mockResolvedValueOnce(0);

      await expect(store.markStaleIfLockLost(ref, 86_400)).resolves.toBe(true);
      await expect(store.markStaleIfLockLost(ref, 86_400)).resolves.toBe(false);

      const args = redis.eval.mock.calls[0] as unknown[];
      expect(args[0]).toContain('SERVER_RESTART');
      expect(args[0]).toContain("redis.call('GET', KEYS[2]) == ARGV[2]"); // lock still ours: alive
      expect(args.slice(1, 5)).toEqual([3, runKey, lockKey, postKey]);
    });
  });

  describe('latestForPosts', () => {
    it('finds the latest run of each post in two Redis round trips', async () => {
      const pointers = {
        get: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, RUN_ID],
          [null, null], // a post that never had a run
        ]),
      };
      const hashes = {
        hgetall: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [
            null,
            {
              id: RUN_ID,
              clientId: 'c1111111-1111-4111-8111-111111111111',
              clientName: 'Acme',
              accountId: '114022207011543',
              platform: 'facebook',
              postId: POST,
              state: 'running',
              interruptReason: '',
              total: '12',
              toAnswer: '8',
              queued: '1',
              dropped: '0',
              skipped: '0',
              delaySeconds: '5',
              startedAt: '2026-11-09T10:00:00.000Z',
              estimatedEndAt: '2026-11-09T10:00:35.000Z',
              endedAt: '',
              startedById: actor.id,
              startedByName: 'Admin',
              stoppedById: '',
              stoppedByName: '',
            },
          ],
        ]),
      };
      redis.pipeline.mockReturnValueOnce(pointers).mockReturnValueOnce(hashes);

      const found = await store.latestForPosts('facebook', [POST, 'no-run']);

      expect(pointers.get).toHaveBeenNthCalledWith(1, postKey);
      expect(pointers.get).toHaveBeenNthCalledWith(
        2,
        `${BACKFILL_POST}facebook:no-run`,
      );
      expect(hashes.hgetall).toHaveBeenCalledTimes(1);
      expect(hashes.hgetall).toHaveBeenCalledWith(runKey);
      expect([...found.keys()]).toEqual([POST]);
      expect(found.get(POST)).toMatchObject({ id: RUN_ID, handled: 1 });
    });

    it('skips the second round trip when no post has a run', async () => {
      redis.pipeline.mockReturnValueOnce({
        get: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, null]]),
      });
      const found = await store.latestForPosts('facebook', [POST]);
      expect(found.size).toBe(0);
      expect(redis.pipeline).toHaveBeenCalledTimes(1);
    });

    it('ignores a pointer whose run has expired', async () => {
      redis.pipeline
        .mockReturnValueOnce({
          get: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([[null, RUN_ID]]),
        })
        .mockReturnValueOnce({
          hgetall: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([[null, {}]]),
        });
      const found = await store.latestForPosts('facebook', [POST]);
      expect(found.size).toBe(0);
    });

    it('returns nothing for no posts, without touching Redis', async () => {
      const found = await store.latestForPosts('facebook', []);
      expect(found.size).toBe(0);
      expect(redis.pipeline).not.toHaveBeenCalled();
    });
  });
});
