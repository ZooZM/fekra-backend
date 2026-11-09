// inbox/comment-backfill.service.ts
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  forwardRef,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { ClientsService } from '@app/clients/clients.service';
import { ClientActor } from '@app/clients/types/client.types';
import { BackfillRunStore, RunRef, StoredRun } from './backfill-run.store';
import { GraphError } from './graph-api.service';
import { InboxItem, Platform } from './inbox.types';
import {
  isAccessError,
  PostComment,
  PostCommentsService,
} from './post-comments.service';
import { PriorityInboxService } from './priority-inbox.service';
import {
  BackfillRun,
  BackfillStartResult,
  CommentBackfillInput,
  InterruptReason,
} from './schemas/comment-backfill.schema';

/**
 * How long past one pause a run's lock survives without being renewed: a re-check (3 tries of
 * 10 s plus the backoff) and a push fit well inside it. If the process dies, the lock expires
 * after this and the post is free again.
 */
const LOCK_GRACE_MS = 60_000;

/**
 * Replies to old comments on a post that the page never answered
 * (port of the "reply to old comments" n8n workflow), as a "run" an admin can follow and stop.
 *
 * 1. `start` reads the post's top-level comments and keeps the ones the page hasn't answered
 *    (PostCommentsService, the same rule the dashboard's unreplied count uses).
 * 2. A background worker pushes them into the inbox one at a time with a delay, exactly like
 *    live webhook comments, so they go through the same dedupe, blocklist, classifier and
 *    CommentReplyService.
 * 3. Just before each comment, the worker checks that the run wasn't stopped, that the client
 *    still has comment replies on, and that the comment still needs a reply.
 *
 * The run's state lives in Redis (BackfillRunStore), so every instance sees the same runs and
 * only one run per post can be in progress.
 */
@Injectable()
export class CommentBackfillService implements OnModuleDestroy {
  private readonly logger = new Logger(CommentBackfillService.name);
  /** Runs this instance is feeding, so a shutdown can mark them interrupted. */
  private readonly active = new Map<string, RunRef>();
  private stopped = false;

  constructor(
    @Inject(forwardRef(() => ClientsService))
    private readonly clients: ClientsService,
    private readonly inbox: PriorityInboxService,
    private readonly config: ConfigService,
    private readonly postComments: PostCommentsService,
    private readonly store: BackfillRunStore,
  ) {}

  /**
   * Marks this instance's runs as interrupted. Best effort: Redis may already be closing, and if
   * it is, the lock expiring does the same job (see `getRun`).
   */
  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    const ttl = this.resultTtlSec();
    await Promise.allSettled(
      [...this.active.values()].map((run) =>
        this.store.end(run, 'interrupted', 'SERVER_RESTART', ttl),
      ),
    );
  }

  private num(name: string, fallback: number): number {
    const value = Number(this.config.get(name));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  /** A TTL of 0 would delete the run at once, so it falls back to the default. */
  private resultTtlSec(): number {
    const seconds = Math.floor(
      this.num('COMMENT_BACKFILL_RESULT_TTL_SEC', 86400),
    );
    return seconds > 0 ? seconds : 86400;
  }

  /**
   * Finds the unanswered comments and starts feeding them to the inbox in the background.
   * Returns right away with the counts; the run itself can take several minutes. When nothing
   * needs a reply, nothing starts and nothing is recorded (`run: null`).
   */
  async start(
    input: CommentBackfillInput,
    actor: ClientActor,
  ): Promise<BackfillStartResult> {
    const { accountId, postId } = input;

    const client = await this.clients.getClientDataForWorkFlow(accountId);
    if (!client) throw new NotFoundException('No client owns this account');
    const platform: Platform =
      client.fbPageId === accountId ? 'facebook' : 'instagram';

    // with replies off the run would go through every comment and post nothing
    if (!client.commentReplyConfig.enabled) {
      throw new ConflictException({
        message: 'Comment replies are turned off for this client',
        errorCode: 'COMMENT_REPLIES_DISABLED',
      });
    }

    const token = await this.clients.getAccessToken(client.id);
    if (!token)
      throw new BadRequestException('No access token stored for this client');

    const delayMs = this.num('COMMENT_BACKFILL_DELAY_MS', 5000);
    const ref: RunRef = { id: randomUUID(), platform, postId };
    const acquired = await this.store.acquireLock(
      platform,
      postId,
      ref.id,
      delayMs + LOCK_GRACE_MS,
    );
    if (!acquired) {
      throw new ConflictException({
        message: 'A backfill is already running for this post',
        errorCode: 'CONFLICT',
        details: { runId: await this.store.lockHolder(platform, postId) },
      });
    }

    let found: Awaited<ReturnType<PostCommentsService['listUnreplied']>>;
    try {
      found = await this.postComments.listUnreplied(
        platform,
        accountId,
        postId,
        token,
      );
    } catch (err) {
      await this.release(ref);
      throw toHttpError(err, platform, postId);
    }

    const { checked, unreplied } = found;
    if (unreplied.length === 0) {
      await this.release(ref);
      this.logger.log(
        `Backfill ${platform}:${postId}: nothing to answer (${checked} comments checked)`,
      );
      return {
        platform,
        postId,
        total: checked,
        pending: 0,
        delaySeconds: delayMs / 1000,
        run: null,
      };
    }

    const startedAt = Date.now();
    const run: StoredRun = {
      id: ref.id,
      clientId: client.id,
      clientName: client.name,
      accountId,
      platform,
      postId,
      state: 'running',
      interruptReason: null,
      total: checked,
      toAnswer: unreplied.length,
      handled: 0,
      queued: 0,
      dropped: 0,
      skipped: 0,
      delaySeconds: delayMs / 1000,
      startedAt: new Date(startedAt).toISOString(),
      // the first comment goes at once, then one every pause
      estimatedEndAt: new Date(
        startedAt + (unreplied.length - 1) * delayMs,
      ).toISOString(),
      endedAt: null,
      startedBy: { id: actor.id, name: actor.name },
      stoppedBy: null,
    };

    try {
      // recorded before anything is sent: a run must never go unrecorded (FR-019)
      await this.clients.recordReplyRun(
        { id: client.id, name: client.name },
        'REPLY_RUN_STARTED',
        actor,
        {
          runId: run.id,
          platform,
          accountId,
          postId,
          toAnswer: unreplied.length,
        },
      );
      await this.store.create(run);
    } catch (err) {
      await this.release(ref);
      throw err;
    }

    this.logger.log(
      `Backfill run ${run.id} started on ${platform}:${postId} by admin ${actor.id}: ${unreplied.length}/${checked} comments without a reply`,
    );
    this.active.set(run.id, ref);
    void this.feed(run, unreplied, token, delayMs);

    return {
      platform,
      postId,
      total: checked,
      pending: unreplied.length,
      delaySeconds: delayMs / 1000,
      run: publicRun(run),
    };
  }

  /** The run's state and progress. A run that lost its worker is reported as interrupted. */
  async getRun(runId: string): Promise<BackfillRun> {
    const run = await this.store.get(runId);
    if (!run) throw runNotFound();
    return publicRun(await this.settle(run));
  }

  /**
   * Stops a run: no further comment is started, and the one being handled is completed.
   * The post is free for a new run right away. Recorded in the activity record.
   */
  async stopRun(runId: string, actor: ClientActor): Promise<BackfillRun> {
    const run = await this.store.get(runId);
    if (!run) throw runNotFound();

    const previous = await this.store.stop(run, actor, this.resultTtlSec());
    if (previous === null) throw runNotFound();
    if (previous !== 'running') {
      throw new ConflictException({
        message: 'This run has already ended',
        errorCode: 'BACKFILL_RUN_ENDED',
        details: { state: previous },
      });
    }

    const stopped = (await this.store.get(runId)) ?? {
      ...run,
      state: 'stopped' as const,
    };
    try {
      await this.clients.recordReplyRun(
        { id: run.clientId, name: run.clientName },
        'REPLY_RUN_STOPPED',
        actor,
        {
          runId,
          platform: run.platform,
          accountId: run.accountId,
          postId: run.postId,
          toAnswer: run.toAnswer,
          handled: stopped.handled,
        },
      );
    } catch (err) {
      // the run stays stopped: stopping is the safe direction. The admin sees the failure.
      this.logger.error(
        `Backfill run ${runId} was stopped but recording it failed: ${(err as Error).message}`,
      );
      throw err;
    }
    this.logger.log(
      `Backfill run ${runId} stopped by admin ${actor.id}: handled ${stopped.handled} of ${run.toAnswer}`,
    );
    return publicRun(stopped);
  }

  /** The latest run of each post, for the posts list. */
  async latestRuns(
    platform: Platform,
    postIds: string[],
  ): Promise<Map<string, BackfillRun>> {
    const found = await this.store.latestForPosts(platform, postIds);
    const out = new Map<string, BackfillRun>();
    for (const [postId, run] of found) {
      out.set(postId, publicRun(await this.settle(run)));
    }
    return out;
  }

  /**
   * A run that is `running` but whose lock is gone lost its worker (the process died): it becomes
   * `interrupted` the first time anyone looks at it.
   */
  private async settle(run: StoredRun): Promise<StoredRun> {
    if (run.state !== 'running') return run;
    const changed = await this.store.markStaleIfLockLost(
      run,
      this.resultTtlSec(),
    );
    return changed ? ((await this.store.get(run.id)) ?? run) : run;
  }

  private async release(run: RunRef): Promise<void> {
    await this.store.releaseLock(run).catch((err: Error) => {
      // it expires on its own; nothing else to do
      this.logger.warn(`Could not free the lock of ${run.id}: ${err.message}`);
    });
  }

  /** Pushes one comment, waits, pushes the next. Never throws. */
  private async feed(
    run: StoredRun,
    comments: PostComment[],
    token: string,
    delayMs: number,
  ): Promise<void> {
    const ttl = this.resultTtlSec();
    try {
      for (const [i, c] of comments.entries()) {
        if (i > 0 && delayMs > 0) await sleep(delayMs);
        // checked after the wait: shutdown may happen during it. onModuleDestroy marks the run
        // interrupted; if Redis is already closed, the lock expiring does it.
        if (this.stopped) return;

        try {
          if (!(await this.step(run, c, token, delayMs + LOCK_GRACE_MS, ttl))) {
            return;
          }
        } catch (err) {
          this.logger.error(
            `Backfill run ${run.id}: comment ${c.id} failed: ${(err as Error).message}`,
          );
          await this.store.incr(run.id, 'skipped').catch(() => undefined);
        }
      }
      await this.store.end(run, 'finished', null, ttl);
      this.logger.log(`Backfill run ${run.id} finished`);
    } catch (err) {
      this.logger.error(
        `Backfill run ${run.id} failed: ${(err as Error).message}`,
      );
    } finally {
      this.active.delete(run.id);
    }
  }

  /** Handles one comment. False means the run is over (or no longer ours) and the loop must exit. */
  private async step(
    run: StoredRun,
    c: PostComment,
    token: string,
    lockTtlMs: number,
    ttl: number,
  ): Promise<boolean> {
    // stopped, from any instance
    if ((await this.store.get(run.id))?.state !== 'running') return false;
    // lost the lock (it expired): someone else may be running the post, and the stale check will
    // report this run as interrupted
    if (!(await this.store.renewLock(run, lockTtlMs))) return false;

    const reason = await this.interruption(run);
    if (reason) {
      await this.interrupt(run, reason, ttl);
      return false;
    }

    let outcome: Awaited<ReturnType<PostCommentsService['recheck']>>;
    try {
      outcome = await this.postComments.recheck(
        run.platform,
        run.accountId,
        c.id,
        token,
      );
    } catch (err) {
      if (!isAccessError(err)) throw err;
      // every following check would fail the same way
      await this.interrupt(run, 'META_ACCESS_LOST', ttl);
      return false;
    }
    if (outcome !== 'needs_reply') {
      this.logger.debug(`Backfill run ${run.id}: skipped ${c.id} (${outcome})`);
      await this.store.incr(run.id, 'skipped');
      return true;
    }

    const item: InboxItem = {
      kind: 'comment',
      platform: run.platform,
      id: c.id,
      accountId: run.accountId,
      senderId: c.senderId,
      text: c.text,
      postId: run.postId,
      // enqueue time, not comment time: an old timestamp would jump ahead of live comments
      timestamp: Date.now(),
      raw: { source: 'backfill', createdAt: c.createdAt },
    };
    const queued = await this.inbox.push(item, { skipRateLimit: true });
    await this.store.incr(run.id, queued ? 'queued' : 'dropped');
    return true;
  }

  /** Why the run can't go on, from the client's current settings, or null. */
  private async interruption(run: StoredRun): Promise<InterruptReason | null> {
    let client: Awaited<ReturnType<ClientsService['findById']>>;
    try {
      client = await this.clients.findById(run.clientId);
    } catch (err) {
      if (err instanceof NotFoundException) return 'ACCOUNT_DISCONNECTED';
      throw err;
    }
    const accountId =
      run.platform === 'facebook' ? client.fbPageId : client.instaAccountId;
    if (accountId !== run.accountId) return 'ACCOUNT_DISCONNECTED';
    if (!client.commentReplyConfig.enabled) return 'COMMENT_REPLIES_DISABLED';
    return null;
  }

  private async interrupt(
    run: StoredRun,
    reason: InterruptReason,
    ttl: number,
  ): Promise<void> {
    if (await this.store.end(run, 'interrupted', reason, ttl)) {
      this.logger.warn(`Backfill run ${run.id} interrupted: ${reason}`);
    }
  }
}

const runNotFound = () =>
  new NotFoundException({
    message: 'Run not found, or it ended more than a day ago',
    errorCode: 'BACKFILL_RUN_NOT_FOUND',
  });

/** The client's name is kept for the activity record only; it is never returned. */
function publicRun(stored: StoredRun): BackfillRun {
  const run: Partial<StoredRun> = { ...stored };
  delete run.clientName;
  return run as BackfillRun;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Meta's errors are about the caller's input or the client's token, not a server fault,
 * so they become 4xx/5xx responses with a hint instead of a bare 500.
 * https://developers.facebook.com/docs/graph-api/guides/error-handling
 */
export function toHttpError(
  err: unknown,
  platform: Platform,
  postId: string,
): unknown {
  if (!(err instanceof GraphError)) return err;
  const details = { graphCode: err.code, graphSubcode: err.subcode };

  // 190: token expired, revoked or invalid
  if (err.code === 190) {
    return new BadRequestException({
      message:
        "The client's access token is invalid or expired. Set a new one with PUT /clients/:id/access-token",
      errorCode: 'META_TOKEN_INVALID',
      details,
    });
  }
  // 10 and 200-299: the token is valid but lacks a permission
  if (err.code === 10 || (err.code && err.code >= 200 && err.code < 300)) {
    return new BadRequestException({
      message:
        platform === 'facebook'
          ? 'The page token is missing a permission to read comments (pages_read_engagement, pages_read_user_content)'
          : 'The page token is missing a permission to read Instagram comments (instagram_basic, instagram_manage_comments)',
      errorCode: 'META_PERMISSION_DENIED',
      details,
    });
  }
  // 100 (/33 for "does not exist"): unknown id, or an object this token can't see
  if (err.code === 100 || err.code === 803) {
    return new NotFoundException({
      message:
        platform === 'facebook'
          ? `Post ${postId} was not found on this page. Use the post id as "{pageId}_{postId}", e.g. the post_id from a comment webhook`
          : `Media ${postId} was not found on this Instagram account. Use the media id from a comment webhook (media.id)`,
      errorCode: 'META_POST_NOT_FOUND',
      details,
    });
  }
  if (err.temporary) {
    return new ServiceUnavailableException({
      message: 'The Meta Graph API is unavailable right now, try again later',
      errorCode: 'META_UNAVAILABLE',
      details,
    });
  }
  return new BadGatewayException({
    message: `The Meta Graph API rejected the request: ${err.message}`,
    errorCode: 'META_ERROR',
    details,
  });
}
