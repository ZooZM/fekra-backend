// client-posts/client-posts.service.ts
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ClientsService } from '@app/clients/clients.service';
import { GraphToken } from '@app/clients/types/client.types';
import {
  CommentBackfillService,
  toHttpError,
} from '@app/inbox/comment-backfill.service';
import { GraphApiService, GraphError } from '@app/inbox/graph-api.service';
import { PostCommentsService } from '@app/inbox/post-comments.service';
import {
  ClientPost,
  ClientPostPage,
  UnrepliedCount,
} from './schemas/client-post-record.schema';
import { ClientPostsQueryInput } from './schemas/client-posts-query.schema';
import {
  FacebookPost,
  GraphPage,
  InstagramMedia,
  Platform,
} from './types/client-post.types';

const FACEBOOK_FIELDS =
  'id,message,created_time,permalink_url,full_picture,comments.summary(true).limit(0)';
const INSTAGRAM_FIELDS =
  'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,comments_count';
const MAX_TEXT = 500;

/**
 * Reads a client's posts live from Facebook or Instagram. Nothing is stored: the dashboard
 * shows the state of the account at the moment it asked (FR-009).
 *
 * The unreplied count of a post is a separate call, so the posts appear without waiting for
 * up to 500 comments each to be read (FR-024).
 */
@Injectable()
export class ClientPostsService {
  private readonly logger = new Logger(ClientPostsService.name);

  constructor(
    private readonly clients: ClientsService,
    private readonly graph: GraphApiService,
    private readonly postComments: PostCommentsService,
    private readonly backfill: CommentBackfillService,
  ) {}

  async list(
    clientId: string,
    query: ClientPostsQueryInput,
  ): Promise<ClientPostPage> {
    const { platform, after, limit } = query;
    const { id, accountId } = await this.account(clientId, platform);
    const auth = await this.tokenOf(id, platform);

    const params = new URLSearchParams({
      fields: platform === 'facebook' ? FACEBOOK_FIELDS : INSTAGRAM_FIELDS,
      limit: String(limit),
    });
    if (after) params.set('after', after);
    // Instagram goes to graph.instagram.com with the client's Instagram token, or to
    // graph.facebook.com with the Page token when it has none, like the comment flow
    const edge = platform === 'facebook' ? 'posts' : 'media';
    const url = `${this.graph.host(auth.api)}/${accountId}/${edge}?${params.toString()}`;

    let page: GraphPage<FacebookPost & InstagramMedia>;
    try {
      page = await this.graph.get(url, auth.token);
    } catch (err) {
      throw this.listError(err, platform, accountId);
    }

    const data = (page.data ?? []).map((p) =>
      platform === 'facebook' ? fromFacebook(p) : fromInstagram(p),
    );
    await this.attachRuns(platform, data);
    this.logger.debug(
      `Listed ${data.length} ${platform} posts for client ${clientId}`,
    );
    return {
      data,
      meta: {
        limit,
        // Graph keeps sending cursors on the last page; only `next` says there is more
        nextCursor: page.paging?.next
          ? (page.paging.cursors?.after ?? null)
          : null,
        fetchedAt: new Date().toISOString(),
      },
    };
  }

  /** Counts with the same rule a reply run uses, so the number matches what a run would answer. */
  async unrepliedCount(
    clientId: string,
    postId: string,
    platform: Platform,
  ): Promise<UnrepliedCount> {
    const { id, accountId } = await this.account(clientId, platform);

    // Checked before the token is read: this client's token must not be used on another
    // page's post. `{pageId}_` with the underscore, so a longer page id can't pass as a prefix.
    // Instagram media ids carry no owner; Meta refuses media this token cannot read (code 100).
    if (platform === 'facebook' && !postId.startsWith(`${accountId}_`)) {
      throw new NotFoundException({
        message: `Post ${postId} was not found on this page`,
        errorCode: 'META_POST_NOT_FOUND',
      });
    }
    const auth = await this.tokenOf(id, platform);

    try {
      const { checked, unreplied, truncated } =
        await this.postComments.listUnreplied(
          platform,
          accountId,
          postId,
          auth,
        );
      return {
        postId,
        platform,
        checked,
        unrepliedCount: unreplied.length,
        truncated,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      throw toHttpError(err, platform, postId);
    }
  }

  /**
   * Each post's latest reply run, in one Redis round trip. The posts matter more than the run
   * info, so a Redis failure here leaves `replyRun` null and the list still loads.
   */
  private async attachRuns(
    platform: Platform,
    posts: ClientPost[],
  ): Promise<void> {
    if (!posts.length) return;
    try {
      const runs = await this.backfill.latestRuns(
        platform,
        posts.map((p) => p.id),
      );
      for (const post of posts) post.replyRun = runs.get(post.id) ?? null;
    } catch (err) {
      this.logger.warn(
        `Could not read the reply runs of ${posts.length} ${platform} posts: ${(err as Error).message}`,
      );
    }
  }

  /** The client and its account on this platform; 404 when there is no such client or account. */
  private async account(clientId: string, platform: Platform) {
    const client = await this.clients.findById(clientId);
    const accountId =
      platform === 'facebook' ? client.fbPageId : client.instaAccountId;
    if (!accountId) {
      throw new NotFoundException({
        message: 'This account is not connected to the client',
        errorCode: 'ACCOUNT_NOT_CONNECTED',
      });
    }
    return { id: client.id, accountId };
  }

  private async tokenOf(
    clientId: string,
    platform: Platform,
  ): Promise<GraphToken> {
    const auth = await this.clients.getGraphToken(clientId, platform);
    if (!auth) {
      throw new BadRequestException('No access token stored for this client');
    }
    return auth;
  }

  /**
   * On a list, "object does not exist" means the saved account id is not one this token can
   * see, not a missing post, so it gets the account error. Everything else is the shared mapping.
   */
  private listError(err: unknown, platform: Platform, accountId: string) {
    if (err instanceof GraphError && (err.code === 100 || err.code === 803)) {
      return new NotFoundException({
        message:
          "Facebook or Instagram cannot find this account with the client's access token. Check the account id and the token",
        errorCode: 'ACCOUNT_NOT_CONNECTED',
        details: { graphCode: err.code, graphSubcode: err.subcode },
      });
    }
    return toHttpError(err, platform, accountId);
  }
}

const toIso = (value?: string): string => {
  const ms = value ? Date.parse(value) : NaN;
  return new Date(Number.isNaN(ms) ? 0 : ms).toISOString();
};

/** Only https links reach the dashboard: it renders them as images and links. */
const httpsOrNull = (url?: string): string | null =>
  url?.startsWith('https://') ? url : null;

/** The first 500 characters, without splitting an emoji. Null when there is no text. */
function cut(raw?: string): { text: string | null; textTruncated: boolean } {
  const text = raw?.trim();
  if (!text) return { text: null, textTruncated: false };
  if (text.length <= MAX_TEXT) return { text, textTruncated: false };

  let end = MAX_TEXT;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // a lone high surrogate is half an emoji
  return { text: text.slice(0, end), textTruncated: true };
}

const fromFacebook = (p: FacebookPost): ClientPost => ({
  id: p.id,
  platform: 'facebook',
  publishedAt: toIso(p.created_time),
  ...cut(p.message),
  thumbnailUrl: httpsOrNull(p.full_picture),
  permalink: httpsOrNull(p.permalink_url) ?? `https://www.facebook.com/${p.id}`,
  commentsCount: p.comments?.summary?.total_count ?? 0,
  replyRun: null, // attached afterwards, for the whole page at once
});

const fromInstagram = (m: InstagramMedia): ClientPost => ({
  id: m.id,
  platform: 'instagram',
  publishedAt: toIso(m.timestamp),
  ...cut(m.caption),
  // a video's media_url is the video file itself; its thumbnail is the picture
  thumbnailUrl: httpsOrNull(
    m.media_type === 'VIDEO' ? m.thumbnail_url : m.media_url,
  ),
  // Instagram links can't be built from the media id, so the profile is the fallback
  permalink: httpsOrNull(m.permalink) ?? 'https://www.instagram.com/',
  commentsCount: m.comments_count ?? 0,
  replyRun: null, // attached afterwards, for the whole page at once
});
