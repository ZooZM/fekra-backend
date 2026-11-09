// inbox/backfill-run.store.ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  BACKFILL_LOCK,
  BACKFILL_POST,
  BACKFILL_RUN,
  REDIS,
} from './inbox.constants';
import { Platform } from './inbox.types';
import {
  BackfillRun,
  BackfillRunState,
  InterruptReason,
} from './schemas/comment-backfill.schema';

/** A run as kept in Redis: the API shape plus the client's name, which is never returned. */
export type StoredRun = BackfillRun & { clientName: string };

/** What the finishing methods need to find a run's three keys. */
export type RunRef = Pick<StoredRun, 'id' | 'platform' | 'postId'>;

/** A run that is still `running` keeps its hash this long; an ended run gets the result TTL. */
const RUNNING_TTL_SEC = 48 * 3600;

const runKey = (id: string) => `${BACKFILL_RUN}${id}`;
const lockKey = (platform: Platform, postId: string) =>
  `${BACKFILL_LOCK}${platform}:${postId}`;
const postKey = (platform: Platform, postId: string) =>
  `${BACKFILL_POST}${platform}:${postId}`;

// Every state change is a compare-and-set in Lua: it acts only if the run is still `running`
// (or the lock is still this run's), so a late worker or a second instance can never end,
// renew or release a newer run's state. Redis runs a script as one atomic step.

/** KEYS[1] lock; ARGV[1] run id, ARGV[2] ttl ms. Renews the lock only if this run holds it. */
const RENEW_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0`;

/** KEYS[1] lock; ARGV[1] run id. Frees the lock only if this run holds it. */
const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;

/**
 * KEYS: run, lock, post pointer. ARGV: stopper id, stopper name, ended at, ttl sec, run id.
 * running → stopped. Returns the previous state, or nil when the run does not exist.
 */
const STOP = `
local state = redis.call('HGET', KEYS[1], 'state')
if not state then return false end
if state ~= 'running' then return state end
redis.call('HSET', KEYS[1], 'state', 'stopped', 'stoppedById', ARGV[1], 'stoppedByName', ARGV[2], 'endedAt', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
if redis.call('GET', KEYS[3]) == ARGV[5] then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
if redis.call('GET', KEYS[2]) == ARGV[5] then redis.call('DEL', KEYS[2]) end
return state`;

/**
 * KEYS: run, lock, post pointer. ARGV: new state, reason, ended at, ttl sec, run id.
 * running → finished or interrupted. Returns 1 if it changed the run, 0 if it was not running.
 */
const END = `
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'running' then return 0 end
redis.call('HSET', KEYS[1], 'state', ARGV[1], 'interruptReason', ARGV[2], 'endedAt', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
if redis.call('GET', KEYS[3]) == ARGV[5] then redis.call('EXPIRE', KEYS[3], ARGV[4]) end
if redis.call('GET', KEYS[2]) == ARGV[5] then redis.call('DEL', KEYS[2]) end
return 1`;

/**
 * KEYS: run, lock, post pointer. ARGV: ended at, run id, ttl sec.
 * A run that is `running` but whose lock is gone or taken by another run lost its worker (the
 * process died): running → interrupted (SERVER_RESTART). Returns 1 if it changed the run.
 */
const MARK_STALE = `
local state = redis.call('HGET', KEYS[1], 'state')
if state ~= 'running' then return 0 end
if redis.call('GET', KEYS[2]) == ARGV[2] then return 0 end
redis.call('HSET', KEYS[1], 'state', 'interrupted', 'interruptReason', 'SERVER_RESTART', 'endedAt', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[3])
if redis.call('GET', KEYS[3]) == ARGV[2] then redis.call('EXPIRE', KEYS[3], ARGV[3]) end
return 1`;

/**
 * Redis side of the reply runs: the one-run-per-post lock, the run's state and counters, and the
 * pointer to a post's latest run. Shared by every API instance, so a stop or a start on one
 * instance is seen by all of them. Holds no token and no email.
 */
@Injectable()
export class BackfillRunStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  // ─────────────────────────── lock ───────────────────────────

  /** SET NX PX: of two parallel starts on the same post, only one gets it. */
  async acquireLock(
    platform: Platform,
    postId: string,
    runId: string,
    ttlMs: number,
  ): Promise<boolean> {
    const res = await this.redis.set(
      lockKey(platform, postId),
      runId,
      'PX',
      ttlMs,
      'NX',
    );
    return res === 'OK';
  }

  /** The run that holds the post's lock, or null. */
  lockHolder(platform: Platform, postId: string): Promise<string | null> {
    return this.redis.get(lockKey(platform, postId));
  }

  /** False when the lock is gone or another run holds it: this worker must stop. */
  async renewLock(run: RunRef, ttlMs: number): Promise<boolean> {
    const res = await this.redis.eval(
      RENEW_LOCK,
      1,
      lockKey(run.platform, run.postId),
      run.id,
      ttlMs,
    );
    return Number(res) === 1;
  }

  async releaseLock(run: RunRef): Promise<void> {
    await this.redis.eval(
      RELEASE_LOCK,
      1,
      lockKey(run.platform, run.postId),
      run.id,
    );
  }

  // ─────────────────────────── run state ───────────────────────────

  async create(run: StoredRun): Promise<void> {
    const key = runKey(run.id);
    await this.redis
      .multi()
      .hset(key, toHash(run))
      .expire(key, RUNNING_TTL_SEC)
      .set(postKey(run.platform, run.postId), run.id, 'EX', RUNNING_TTL_SEC)
      .exec();
  }

  async get(runId: string): Promise<StoredRun | null> {
    return toRun(await this.redis.hgetall(runKey(runId)));
  }

  /** One handled comment. HINCRBY is atomic, so counters stay right with several instances. */
  async incr(
    runId: string,
    field: 'queued' | 'dropped' | 'skipped',
  ): Promise<void> {
    await this.redis.hincrby(runKey(runId), field, 1);
  }

  /**
   * running → stopped, and frees the post's lock if this run still holds it.
   * Returns the state the run had: `running` means it was stopped now, anything else means it
   * had already ended; null means there is no such run.
   */
  async stop(
    run: RunRef,
    actor: { id: string; name: string },
    ttlSec: number,
  ): Promise<BackfillRunState | null> {
    const res = await this.redis.eval(
      STOP,
      3,
      runKey(run.id),
      lockKey(run.platform, run.postId),
      postKey(run.platform, run.postId),
      actor.id,
      actor.name,
      new Date().toISOString(),
      String(ttlSec),
      run.id,
    );
    return typeof res === 'string' ? (res as BackfillRunState) : null;
  }

  /** running → finished or interrupted. False when the run was not running (someone else ended it). */
  async end(
    run: RunRef,
    state: 'finished' | 'interrupted',
    reason: InterruptReason | null,
    ttlSec: number,
  ): Promise<boolean> {
    const res = await this.redis.eval(
      END,
      3,
      runKey(run.id),
      lockKey(run.platform, run.postId),
      postKey(run.platform, run.postId),
      state,
      reason ?? '',
      new Date().toISOString(),
      String(ttlSec),
      run.id,
    );
    return Number(res) === 1;
  }

  /** Interrupts a run whose worker is gone (its lock expired). True if it changed the run. */
  async markStaleIfLockLost(run: RunRef, ttlSec: number): Promise<boolean> {
    const res = await this.redis.eval(
      MARK_STALE,
      3,
      runKey(run.id),
      lockKey(run.platform, run.postId),
      postKey(run.platform, run.postId),
      new Date().toISOString(),
      run.id,
      String(ttlSec),
    );
    return Number(res) === 1;
  }

  /** The latest run of each post, in two round trips: the pointers, then the hashes. */
  async latestForPosts(
    platform: Platform,
    postIds: string[],
  ): Promise<Map<string, StoredRun>> {
    const out = new Map<string, StoredRun>();
    if (!postIds.length) return out;

    const pointers = this.redis.pipeline();
    for (const id of postIds) pointers.get(postKey(platform, id));
    const found: { postId: string; runId: string }[] = [];
    ((await pointers.exec()) ?? []).forEach(([err, runId], i) => {
      if (!err && typeof runId === 'string') {
        found.push({ postId: postIds[i], runId });
      }
    });
    if (!found.length) return out;

    const hashes = this.redis.pipeline();
    for (const { runId } of found) hashes.hgetall(runKey(runId));
    ((await hashes.exec()) ?? []).forEach(([err, hash], i) => {
      if (err) return;
      const run = toRun(hash as Record<string, string>);
      if (run) out.set(found[i].postId, run);
    });
    return out;
  }
}

/** Flat string fields: a Redis hash holds nothing else. `handled` is not stored, it is computed. */
function toHash(run: StoredRun): Record<string, string> {
  return {
    id: run.id,
    clientId: run.clientId,
    clientName: run.clientName,
    accountId: run.accountId,
    platform: run.platform,
    postId: run.postId,
    state: run.state,
    interruptReason: run.interruptReason ?? '',
    total: String(run.total),
    toAnswer: String(run.toAnswer),
    queued: String(run.queued),
    dropped: String(run.dropped),
    skipped: String(run.skipped),
    delaySeconds: String(run.delaySeconds),
    startedAt: run.startedAt,
    estimatedEndAt: run.estimatedEndAt,
    endedAt: run.endedAt ?? '',
    startedById: run.startedBy.id,
    startedByName: run.startedBy.name,
    stoppedById: run.stoppedBy?.id ?? '',
    stoppedByName: run.stoppedBy?.name ?? '',
  };
}

const int = (value: string | undefined) => Number(value) || 0;

function toRun(h: Record<string, string> | null | undefined): StoredRun | null {
  if (!h || Object.keys(h).length === 0) return null;
  const queued = int(h.queued);
  const dropped = int(h.dropped);
  const skipped = int(h.skipped);
  return {
    id: h.id,
    clientId: h.clientId,
    clientName: h.clientName,
    accountId: h.accountId,
    platform: h.platform as Platform,
    postId: h.postId,
    state: h.state as BackfillRunState,
    interruptReason: (h.interruptReason || null) as InterruptReason | null,
    total: int(h.total),
    toAnswer: int(h.toAnswer),
    handled: queued + dropped + skipped,
    queued,
    dropped,
    skipped,
    delaySeconds: Number(h.delaySeconds) || 0,
    startedAt: h.startedAt,
    estimatedEndAt: h.estimatedEndAt,
    endedAt: h.endedAt || null,
    startedBy: { id: h.startedById, name: h.startedByName },
    stoppedBy: h.stoppedById
      ? { id: h.stoppedById, name: h.stoppedByName ?? '' }
      : null,
  };
}
