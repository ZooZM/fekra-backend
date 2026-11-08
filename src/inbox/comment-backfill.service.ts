// inbox/comment-backfill.service.ts
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsService } from '@app/clients/clients.service';
import { GraphApiService, GraphError } from './graph-api.service';
import { PriorityInboxService } from './priority-inbox.service';
import { InboxItem, Platform } from './inbox.types';
import { CommentBackfillInput } from './schemas/comment-backfill.schema';

/** A top-level comment, normalized from the Facebook and Instagram shapes. */
export interface PostComment {
  id: string;
  text?: string;
  senderId?: string;
  createdAt: number; // ms
  hidden: boolean;
  /** Who replied to it, to know whether the page already answered. */
  replierIds: string[];
}

export interface CommentBackfillResult {
  platform: Platform;
  postId: string;
  /** Top-level comments on the post (up to the configured maximum). */
  total: number;
  /** Comments the page hasn't replied to; they are fed to the inbox one by one. */
  pending: number;
  /** Seconds between two comments, to avoid Meta's spam limits. */
  delaySeconds: number;
}

interface Page<T> {
  data?: T[];
  paging?: { next?: string };
}

interface FacebookComment {
  id: string;
  message?: string;
  created_time?: string;
  is_hidden?: boolean;
  from?: { id: string };
  comments?: Page<{ from?: { id: string } }>;
}

interface InstagramComment {
  id: string;
  text?: string;
  timestamp?: string;
  hidden?: boolean;
  from?: { id: string };
  replies?: Page<{ from?: { id: string } }>;
}

/**
 * Replies to old comments on a post that the page never answered
 * (port of the "reply to old comments" n8n workflow).
 *
 * 1. Fetch the post's top-level comments (all pages, newest first).
 * 2. Keep the ones that aren't from the page, aren't hidden, and have no reply from the page.
 * 3. Push them into the inbox one at a time with a delay, exactly like live webhook comments,
 *    so they go through the same dedupe, blocklist, classifier and CommentReplyService.
 */
@Injectable()
export class CommentBackfillService implements OnModuleDestroy {
  private readonly logger = new Logger(CommentBackfillService.name);
  /** Posts with a run in progress on this instance. Other instances are covered by the inbox dedupe. */
  private readonly running = new Set<string>();
  private stopped = false;

  constructor(
    private readonly graph: GraphApiService,
    @Inject(forwardRef(() => ClientsService))
    private readonly clients: ClientsService,
    private readonly inbox: PriorityInboxService,
    private readonly config: ConfigService,
  ) {}

  onModuleDestroy() {
    this.stopped = true;
  }

  private num(name: string, fallback: number): number {
    const value = Number(this.config.get(name));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  /**
   * Finds the unanswered comments and starts feeding them to the inbox in the background.
   * Returns right away with the counts; the run itself can take several minutes.
   */
  async start(input: CommentBackfillInput): Promise<CommentBackfillResult> {
    const { accountId, postId } = input;

    const client = await this.clients.getClientDataForWorkFlow(accountId);
    if (!client) throw new NotFoundException('No client owns this account');
    const platform: Platform =
      client.fbPageId === accountId ? 'facebook' : 'instagram';

    const token = await this.clients.getAccessToken(client.id);
    if (!token)
      throw new BadRequestException('No access token stored for this client');

    const key = `${platform}:${postId}`;
    if (this.running.has(key)) {
      throw new ConflictException(
        'A backfill is already running for this post',
      );
    }
    this.running.add(key);

    try {
      const comments = await this.fetchComments(platform, postId, token);
      const pending = comments
        .filter((c) => this.needsReply(c, platform, accountId))
        .sort((a, b) => b.createdAt - a.createdAt); // newest first, like the n8n workflow

      const delayMs = this.num('COMMENT_BACKFILL_DELAY_MS', 5000);
      this.logger.log(
        `Backfill ${key}: ${pending.length}/${comments.length} comments without a reply`,
      );

      void this.feed(key, pending, { platform, accountId, postId }, delayMs);

      return {
        platform,
        postId,
        total: comments.length,
        pending: pending.length,
        delaySeconds: delayMs / 1000,
      };
    } catch (err) {
      this.running.delete(key);
      throw toHttpError(err, platform, postId);
    }
  }

  /** Same filters as the live webhooks, plus "the page hasn't replied yet". */
  private needsReply(
    c: PostComment,
    platform: Platform,
    accountId: string,
  ): boolean {
    if (c.senderId === accountId) return false; // the page's own comment
    if (c.hidden) return false; // already moderated
    if (platform === 'instagram' && !c.text) return false; // same as the IG webhook
    return !c.replierIds.includes(accountId);
  }

  /** Pushes one comment, waits, pushes the next. Never throws. */
  private async feed(
    key: string,
    comments: PostComment[],
    target: { platform: Platform; accountId: string; postId: string },
    delayMs: number,
  ): Promise<void> {
    let queued = 0;
    try {
      for (const [i, c] of comments.entries()) {
        if (i > 0 && delayMs > 0) await sleep(delayMs);
        if (this.stopped) break; // checked after the wait: shutdown may happen during it

        const item: InboxItem = {
          kind: 'comment',
          platform: target.platform,
          id: c.id,
          accountId: target.accountId,
          senderId: c.senderId,
          text: c.text,
          postId: target.postId,
          // enqueue time, not comment time: an old timestamp would jump ahead of live comments
          timestamp: Date.now(),
          raw: { source: 'backfill', createdAt: c.createdAt },
        };
        if (await this.inbox.push(item, { skipRateLimit: true })) queued++;
      }
    } catch (err) {
      this.logger.error(`Backfill ${key} failed: ${(err as Error).message}`);
    } finally {
      this.running.delete(key);
      this.logger.log(
        `Backfill ${key} done: ${queued}/${comments.length} queued (the rest were duplicates or blocked)`,
      );
    }
  }

  /** All top-level comments of the post, following pagination up to COMMENT_BACKFILL_MAX. */
  async fetchComments(
    platform: Platform,
    postId: string,
    token: string,
  ): Promise<PostComment[]> {
    const max = this.num('COMMENT_BACKFILL_MAX', 500);
    // Instagram also goes through graph.facebook.com with the Page token, like CommentReplyService
    const base = this.graph.host('facebook');
    const params =
      platform === 'facebook'
        ? new URLSearchParams({
            fields:
              'id,message,created_time,is_hidden,from{id},comments.limit(100){from{id}}',
            filter: 'toplevel',
            order: 'reverse_chronological',
            limit: '100',
          })
        : new URLSearchParams({
            fields:
              'id,text,timestamp,hidden,from{id},replies.limit(50){from{id}}',
            limit: '50',
          });

    const normalize = platform === 'facebook' ? fromFacebook : fromInstagram;
    const out: PostComment[] = [];
    let url: string | undefined =
      `${base}/${postId}/comments?${params.toString()}`;

    while (url && out.length < max) {
      const page: Page<FacebookComment & InstagramComment> =
        await this.graph.get(url, token);
      out.push(...(page.data ?? []).map(normalize));
      url = page.paging?.next;
    }
    return out.slice(0, max);
  }
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

const toMs = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);

const replierIds = (page?: Page<{ from?: { id: string } }>) =>
  (page?.data ?? []).map((r) => r.from?.id).filter((id): id is string => !!id);

const fromFacebook = (c: FacebookComment): PostComment => ({
  id: c.id,
  text: c.message,
  senderId: c.from?.id,
  createdAt: toMs(c.created_time),
  hidden: c.is_hidden === true,
  replierIds: replierIds(c.comments),
});

const fromInstagram = (c: InstagramComment): PostComment => ({
  id: c.id,
  text: c.text,
  senderId: c.from?.id,
  createdAt: toMs(c.timestamp),
  hidden: c.hidden === true,
  replierIds: replierIds(c.replies),
});
