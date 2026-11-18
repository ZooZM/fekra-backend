// inbox/post-comments.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GraphApiService, GraphError } from './graph-api.service';
import { Platform } from './inbox.types';
import { GraphToken } from '@app/clients/types/client.types';

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

export interface UnrepliedComments {
  /** Top-level comments read (at most COMMENT_BACKFILL_MAX). */
  checked: number;
  /** The ones the page has not answered, newest first. */
  unreplied: PostComment[];
  /** True when the post has more comments than were read, so the count is a minimum. */
  truncated: boolean;
}

/** What a second look at one comment found, just before a run handles it. */
export type RecheckOutcome =
  'needs_reply' | 'answered' | 'hidden' | 'deleted' | 'check_failed';

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
 * Reads a post's comments and decides which ones still need a reply.
 *
 * Both the unreplied count shown in the dashboard and the reply run use this class, so the
 * number an admin sees is the number a run started at that moment would try to answer.
 */
@Injectable()
export class PostCommentsService {
  constructor(
    private readonly graph: GraphApiService,
    private readonly config: ConfigService,
  ) {}

  private num(name: string, fallback: number): number {
    const value = Number(this.config.get(name));
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  }

  /** The comments the page has not answered, newest first. Lets Graph errors through. */
  async listUnreplied(
    platform: Platform,
    accountId: string,
    postId: string,
    auth: GraphToken,
  ): Promise<UnrepliedComments> {
    const { comments, truncated } = await this.fetchComments(
      platform,
      postId,
      auth,
    );
    const unreplied = comments
      .filter((c) => this.needsReply(c, platform, accountId))
      .sort((a, b) => b.createdAt - a.createdAt);
    return { checked: comments.length, unreplied, truncated };
  }

  /** Same filters as the live webhooks, plus "the page hasn't replied yet". */
  needsReply(c: PostComment, platform: Platform, accountId: string): boolean {
    if (c.senderId === accountId) return false; // the page's own comment
    if (c.hidden) return false; // already moderated
    if (platform === 'instagram' && !c.text) return false; // same as the IG webhook
    return !c.replierIds.includes(accountId);
  }

  /**
   * Looks at one comment again, so a run doesn't answer what a person answered, hid or deleted
   * since the run started (FR-023). A failed check is `check_failed`: the run skips the comment,
   * because a missed reply can be retried by the next run but a duplicate public reply can't be
   * taken back. Throws when the token is rejected, because every following check would fail the
   * same way.
   */
  async recheck(
    platform: Platform,
    accountId: string,
    commentId: string,
    auth: GraphToken,
  ): Promise<RecheckOutcome> {
    const fields =
      platform === 'facebook'
        ? 'id,is_hidden,comments.limit(100){from{id}}'
        : 'id,hidden,replies.limit(50){from{id}}';
    const url = `${this.graph.host(auth.api)}/${commentId}?${new URLSearchParams({ fields }).toString()}`;

    try {
      const c = await this.graph.get<FacebookComment & InstagramComment>(
        url,
        auth.token,
      );
      const hidden = platform === 'facebook' ? c.is_hidden : c.hidden;
      if (hidden === true) return 'hidden';
      const repliers = replierIds(
        platform === 'facebook' ? c.comments : c.replies,
      );
      return repliers.includes(accountId) ? 'answered' : 'needs_reply';
    } catch (err) {
      if (!(err instanceof GraphError)) throw err;
      if (isAccessError(err)) throw err;
      // 100 / 803: the comment no longer exists
      if (err.code === 100 || err.code === 803) return 'deleted';
      return 'check_failed';
    }
  }

  /** All top-level comments of the post, following pagination up to COMMENT_BACKFILL_MAX. */
  private async fetchComments(
    platform: Platform,
    postId: string,
    auth: GraphToken,
  ): Promise<{ comments: PostComment[]; truncated: boolean }> {
    const max = this.num('COMMENT_BACKFILL_MAX', 500);
    // the token says the host: an Instagram token reads graph.instagram.com, a Page token
    // graph.facebook.com (for Instagram too); the fields are the same on both Instagram hosts
    const base = this.graph.host(auth.api);
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
        await this.graph.get(url, auth.token);
      out.push(...(page.data ?? []).map(normalize));
      url = page.paging?.next;
    }
    // more than we keep, or exactly at the limit with another page still to read
    const truncated = out.length > max || (out.length >= max && !!url);
    return { comments: out.slice(0, max), truncated };
  }
}

/**
 * The token is expired or revoked (190) or lacks a permission (10, 200-299). Retrying with the
 * same token can't help, unlike a temporary Meta failure.
 */
export function isAccessError(err: unknown): boolean {
  return (
    err instanceof GraphError &&
    (err.code === 190 ||
      err.code === 10 ||
      (err.code !== undefined && err.code >= 200 && err.code < 300))
  );
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
