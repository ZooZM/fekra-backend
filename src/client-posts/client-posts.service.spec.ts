import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientsService } from '@app/clients/clients.service';
import { GraphApiService, GraphError } from '@app/inbox/graph-api.service';
import { CommentBackfillService } from '@app/inbox/comment-backfill.service';
import { PostCommentsService } from '@app/inbox/post-comments.service';
import { BackfillRun } from '@app/inbox/schemas/comment-backfill.schema';
import { ClientPostsService } from './client-posts.service';

const HOST = 'https://graph.test';
const CLIENT_ID = '8ed9f96d-c790-4279-ba5f-88feec1c68e3';
const PAGE = '11111111111';
const IG = '22222222222';
const TOKEN = 'page-token';
const AUTH = { token: TOKEN, api: 'facebook' } as const; // a Page token
const IG_HOST = 'https://graph.instagram.test';

const errorBody = (e: unknown) =>
  (e as { getResponse: () => unknown }).getResponse();

describe('ClientPostsService', () => {
  let service: ClientPostsService;
  let clients: { findById: jest.Mock; getGraphToken: jest.Mock };
  let graph: {
    host: jest.Mock;
    get: jest.Mock<Promise<unknown>, [string, string]>;
  };
  let postComments: { listUnreplied: jest.Mock };
  let backfill: { latestRuns: jest.Mock };

  beforeEach(() => {
    clients = {
      findById: jest.fn().mockResolvedValue({
        id: CLIENT_ID,
        fbPageId: PAGE,
        instaAccountId: IG,
      }),
      getGraphToken: jest.fn().mockResolvedValue(AUTH),
    };
    graph = {
      host: jest.fn((api: string) => (api === 'facebook' ? HOST : IG_HOST)),
      get: jest.fn<Promise<unknown>, [string, string]>(),
    };
    postComments = {
      listUnreplied: jest.fn().mockResolvedValue({
        checked: 0,
        unreplied: [],
        truncated: false,
      }),
    };
    backfill = { latestRuns: jest.fn().mockResolvedValue(new Map()) };
    service = new ClientPostsService(
      clients as unknown as ClientsService,
      graph as unknown as GraphApiService,
      postComments as unknown as PostCommentsService,
      backfill as unknown as CommentBackfillService,
    );
  });

  const fbPost = (over: Record<string, unknown> = {}) => ({
    id: `${PAGE}_900`,
    message: 'عرض الصيف',
    created_time: '2026-03-01T10:00:00+0000',
    permalink_url: `https://www.facebook.com/${PAGE}/posts/900`,
    full_picture: 'https://scontent.test/p.jpg',
    comments: { data: [], summary: { total_count: 12 } },
    ...over,
  });

  const igMedia = (over: Record<string, unknown> = {}) => ({
    id: '17900000000000001',
    caption: 'new arrivals',
    timestamp: '2026-03-02T10:00:00+0000',
    permalink: 'https://www.instagram.com/p/AAA/',
    media_type: 'IMAGE',
    media_url: 'https://cdn.test/i.jpg',
    comments_count: 4,
    ...over,
  });

  // ─────────────────────────── list ───────────────────────────

  describe('list', () => {
    it('reads the Facebook page feed through graph.facebook.com with the page token', async () => {
      graph.get.mockResolvedValueOnce({ data: [fbPost()] });

      await service.list(CLIENT_ID, { platform: 'facebook', limit: 25 });

      expect(graph.host).toHaveBeenCalledWith('facebook');
      expect(graph.get.mock.calls[0][1]).toBe(TOKEN);
      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe(`${HOST}/${PAGE}/posts`);
      expect(url.searchParams.get('limit')).toBe('25');
      expect(url.searchParams.has('after')).toBe(false);
      expect(url.searchParams.get('fields')).toBe(
        'id,message,created_time,permalink_url,full_picture,comments.summary(true).limit(0)',
      );
    });

    it('maps a Facebook post to the dashboard shape', async () => {
      graph.get.mockResolvedValueOnce({ data: [fbPost()] });

      const page = await service.list(CLIENT_ID, {
        platform: 'facebook',
        limit: 25,
      });

      expect(page.data).toEqual([
        {
          id: `${PAGE}_900`,
          platform: 'facebook',
          publishedAt: '2026-03-01T10:00:00.000Z',
          text: 'عرض الصيف',
          textTruncated: false,
          thumbnailUrl: 'https://scontent.test/p.jpg',
          permalink: `https://www.facebook.com/${PAGE}/posts/900`,
          commentsCount: 12,
          replyRun: null,
        },
      ]);
      expect(page.meta.limit).toBe(25);
      expect(Number.isNaN(Date.parse(page.meta.fetchedAt))).toBe(false);
    });

    it('reads Instagram media and uses thumbnail_url for videos, media_url otherwise', async () => {
      graph.get.mockResolvedValueOnce({
        data: [
          igMedia(),
          igMedia({
            id: '17900000000000002',
            media_type: 'VIDEO',
            media_url: 'https://cdn.test/v.mp4',
            thumbnail_url: 'https://cdn.test/v.jpg',
          }),
        ],
      });

      const page = await service.list(CLIENT_ID, {
        platform: 'instagram',
        limit: 25,
      });

      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe(`${HOST}/${IG}/media`);
      expect(url.searchParams.get('fields')).toBe(
        'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,comments_count',
      );
      expect(page.data.map((p) => p.thumbnailUrl)).toEqual([
        'https://cdn.test/i.jpg',
        'https://cdn.test/v.jpg',
      ]);
      expect(page.data[0]).toMatchObject({
        platform: 'instagram',
        text: 'new arrivals',
        commentsCount: 4,
        permalink: 'https://www.instagram.com/p/AAA/',
      });
    });

    it('reads Instagram media through graph.facebook.com with the Page token when there is no Instagram token', async () => {
      graph.get.mockResolvedValueOnce({ data: [] });
      await service.list(CLIENT_ID, { platform: 'instagram', limit: 25 });

      expect(clients.getGraphToken).toHaveBeenCalledWith(
        CLIENT_ID,
        'instagram',
      );
      expect(graph.get.mock.calls[0][1]).toBe(TOKEN);
      expect(new URL(graph.get.mock.calls[0][0]).origin).toBe(HOST);
    });

    it('reads Instagram media through graph.instagram.com with the Instagram token', async () => {
      clients.getGraphToken.mockResolvedValue({
        token: 'ig-token',
        api: 'instagram',
      });
      graph.get.mockResolvedValueOnce({ data: [igMedia()] });

      const page = await service.list(CLIENT_ID, {
        platform: 'instagram',
        limit: 25,
      });

      expect(graph.get.mock.calls[0][1]).toBe('ig-token');
      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.origin + url.pathname).toBe(`${IG_HOST}/${IG}/media`);
      expect(url.searchParams.get('fields')).toBe(
        'id,caption,timestamp,permalink,media_type,media_url,thumbnail_url,comments_count',
      );
      expect(page.data.map((p) => p.id)).toEqual(['17900000000000001']);
    });

    it('passes the cursor and the page size to Graph', async () => {
      graph.get.mockResolvedValueOnce({ data: [] });

      await service.list(CLIENT_ID, {
        platform: 'facebook',
        limit: 10,
        after: 'QVFI=abc',
      });

      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.searchParams.get('limit')).toBe('10');
      expect(url.searchParams.get('after')).toBe('QVFI=abc');
    });

    it('returns the next cursor only when Graph says there is a next page', async () => {
      graph.get.mockResolvedValueOnce({
        data: [fbPost()],
        paging: { cursors: { after: 'NEXT' }, next: `${HOST}/more` },
      });
      const first = await service.list(CLIENT_ID, {
        platform: 'facebook',
        limit: 25,
      });
      expect(first.meta.nextCursor).toBe('NEXT');

      // Graph keeps sending cursors on the last page, but no `next` link
      graph.get.mockResolvedValueOnce({
        data: [fbPost()],
        paging: { cursors: { after: 'LAST' } },
      });
      const last = await service.list(CLIENT_ID, {
        platform: 'facebook',
        limit: 25,
      });
      expect(last.meta.nextCursor).toBeNull();
    });

    it('returns an empty page for an account without posts', async () => {
      graph.get.mockResolvedValueOnce({ data: [] });
      const page = await service.list(CLIENT_ID, {
        platform: 'facebook',
        limit: 25,
      });
      expect(page.data).toEqual([]);
      expect(page.meta.nextCursor).toBeNull();
    });

    describe('reply runs', () => {
      const run = (id: string, postId: string): BackfillRun =>
        ({ id, postId, state: 'running' }) as BackfillRun;

      it('attaches each post’s latest run, and null to posts that never had one', async () => {
        graph.get.mockResolvedValueOnce({
          data: [fbPost({ id: `${PAGE}_1` }), fbPost({ id: `${PAGE}_2` })],
        });
        backfill.latestRuns.mockResolvedValue(
          new Map([[`${PAGE}_2`, run('run-2', `${PAGE}_2`)]]),
        );

        const page = await service.list(CLIENT_ID, {
          platform: 'facebook',
          limit: 25,
        });

        expect(page.data.map((p) => p.replyRun?.id ?? null)).toEqual([
          null,
          'run-2',
        ]);
      });

      it('looks the runs up once for the whole page, for that platform', async () => {
        graph.get.mockResolvedValueOnce({
          data: [fbPost({ id: `${PAGE}_1` }), fbPost({ id: `${PAGE}_2` })],
        });

        await service.list(CLIENT_ID, { platform: 'facebook', limit: 25 });

        expect(backfill.latestRuns).toHaveBeenCalledTimes(1);
        expect(backfill.latestRuns).toHaveBeenCalledWith('facebook', [
          `${PAGE}_1`,
          `${PAGE}_2`,
        ]);
      });

      it('does not look anything up for an empty page', async () => {
        graph.get.mockResolvedValueOnce({ data: [] });
        await service.list(CLIENT_ID, { platform: 'facebook', limit: 25 });
        expect(backfill.latestRuns).not.toHaveBeenCalled();
      });

      it('still lists the posts, without run info, when the run lookup fails', async () => {
        graph.get.mockResolvedValueOnce({ data: [fbPost()] });
        backfill.latestRuns.mockRejectedValue(new Error('redis down'));

        const page = await service.list(CLIENT_ID, {
          platform: 'facebook',
          limit: 25,
        });

        expect(page.data).toHaveLength(1);
        expect(page.data[0].replyRun).toBeNull();
      });
    });

    describe('post text and media', () => {
      const one = async (post: Record<string, unknown>) => {
        graph.get.mockResolvedValueOnce({ data: [post] });
        const page = await service.list(CLIENT_ID, {
          platform: 'facebook',
          limit: 25,
        });
        return page.data[0];
      };

      it('cuts text longer than 500 characters and says so', async () => {
        const post = await one(fbPost({ message: 'a'.repeat(501) }));
        expect(post.text).toHaveLength(500);
        expect(post.textTruncated).toBe(true);
      });

      it('keeps text of exactly 500 characters whole', async () => {
        const post = await one(fbPost({ message: 'a'.repeat(500) }));
        expect(post.text).toHaveLength(500);
        expect(post.textTruncated).toBe(false);
      });

      it('never cuts an emoji in half', async () => {
        // 499 letters + a 2-unit emoji: a naive slice(0, 500) would keep half of it
        const post = await one(fbPost({ message: `${'a'.repeat(499)}😀tail` }));
        expect(post.textTruncated).toBe(true);
        expect(post.text).toBe('a'.repeat(499));
      });

      it.each([undefined, '', '   '])(
        'gives null for a post without text (%j)',
        async (message) => {
          const post = await one(fbPost({ message }));
          expect(post.text).toBeNull();
          expect(post.textTruncated).toBe(false);
        },
      );

      it('keeps only https thumbnails', async () => {
        expect(
          (await one(fbPost({ full_picture: undefined }))).thumbnailUrl,
        ).toBeNull();
        expect(
          (await one(fbPost({ full_picture: 'http://insecure.test/p.jpg' })))
            .thumbnailUrl,
        ).toBeNull();
        expect(
          (await one(fbPost({ full_picture: 'javascript:alert(1)' })))
            .thumbnailUrl,
        ).toBeNull();
      });

      it('falls back to a Facebook link built from the id when Graph sends none', async () => {
        const post = await one(fbPost({ permalink_url: undefined }));
        expect(post.permalink).toBe(`https://www.facebook.com/${PAGE}_900`);
      });

      it('treats a missing comment summary as zero comments', async () => {
        expect((await one(fbPost({ comments: undefined }))).commentsCount).toBe(
          0,
        );
      });
    });

    describe('refusals and Meta errors', () => {
      const query = { platform: 'facebook', limit: 25 } as const;

      it('passes through a 404 for an unknown client', async () => {
        clients.findById.mockRejectedValue(
          new NotFoundException('Client not found'),
        );
        await expect(service.list(CLIENT_ID, query)).rejects.toBeInstanceOf(
          NotFoundException,
        );
        expect(graph.get).not.toHaveBeenCalled();
      });

      it('404s with ACCOUNT_NOT_CONNECTED when the client has no account on that platform', async () => {
        clients.findById.mockResolvedValue({
          id: CLIENT_ID,
          fbPageId: PAGE,
          instaAccountId: null,
        });

        const thrown = await service
          .list(CLIENT_ID, { platform: 'instagram', limit: 25 })
          .catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(NotFoundException);
        expect(errorBody(thrown)).toMatchObject({
          errorCode: 'ACCOUNT_NOT_CONNECTED',
        });
        expect(graph.get).not.toHaveBeenCalled();
      });

      it('400s when the client has no access token', async () => {
        clients.getGraphToken.mockResolvedValue(null);
        await expect(service.list(CLIENT_ID, query)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(graph.get).not.toHaveBeenCalled();
      });

      it('maps an expired token (190) to META_TOKEN_INVALID', async () => {
        graph.get.mockRejectedValueOnce(
          new GraphError('Graph 400', false, 190),
        );
        const thrown = await service
          .list(CLIENT_ID, query)
          .catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(BadRequestException);
        expect(errorBody(thrown)).toMatchObject({
          errorCode: 'META_TOKEN_INVALID',
        });
      });

      it('maps a temporary Meta failure to META_UNAVAILABLE', async () => {
        graph.get.mockRejectedValueOnce(new GraphError('Graph 500', true, 2));
        const thrown = await service
          .list(CLIENT_ID, query)
          .catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(ServiceUnavailableException);
        expect(errorBody(thrown)).toMatchObject({
          errorCode: 'META_UNAVAILABLE',
        });
      });

      it('says the account cannot be found when Meta does not know it (100)', async () => {
        graph.get.mockRejectedValueOnce(
          new GraphError('Graph 400', false, 100, 33),
        );
        const thrown = await service
          .list(CLIENT_ID, query)
          .catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(NotFoundException);
        expect(errorBody(thrown)).toMatchObject({
          errorCode: 'ACCOUNT_NOT_CONNECTED',
          details: { graphCode: 100 },
        });
      });

      it('never puts the token in an error', async () => {
        graph.get.mockRejectedValueOnce(
          new GraphError('Graph 400', false, 190),
        );
        const thrown = await service
          .list(CLIENT_ID, query)
          .catch((e: unknown) => e);
        expect(JSON.stringify(errorBody(thrown))).not.toContain(TOKEN);
      });
    });
  });

  // ─────────────────────────── unrepliedCount ───────────────────────────

  describe('unrepliedCount', () => {
    it('counts with the same rule as a run, for the right account', async () => {
      postComments.listUnreplied.mockResolvedValue({
        checked: 12,
        unreplied: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        truncated: false,
      });

      const result = await service.unrepliedCount(
        CLIENT_ID,
        `${PAGE}_900`,
        'facebook',
      );

      expect(postComments.listUnreplied).toHaveBeenCalledWith(
        'facebook',
        PAGE,
        `${PAGE}_900`,
        AUTH,
      );
      expect(result).toMatchObject({
        postId: `${PAGE}_900`,
        platform: 'facebook',
        checked: 12,
        unrepliedCount: 3,
        truncated: false,
      });
      expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
    });

    it('passes truncated through, so the UI can show "at least N"', async () => {
      postComments.listUnreplied.mockResolvedValue({
        checked: 500,
        unreplied: [{ id: 'a' }],
        truncated: true,
      });
      const result = await service.unrepliedCount(
        CLIENT_ID,
        `${PAGE}_900`,
        'facebook',
      );
      expect(result).toMatchObject({
        checked: 500,
        unrepliedCount: 1,
        truncated: true,
      });
    });

    it('uses the Instagram account for Instagram media, which carry no page prefix', async () => {
      await service.unrepliedCount(CLIENT_ID, '17900000000000001', 'instagram');
      expect(postComments.listUnreplied).toHaveBeenCalledWith(
        'instagram',
        IG,
        '17900000000000001',
        AUTH,
      );
    });

    it('uses the Instagram token for Instagram media when the client has one', async () => {
      const igAuth = { token: 'ig-token', api: 'instagram' };
      clients.getGraphToken.mockResolvedValue(igAuth);
      await service.unrepliedCount(CLIENT_ID, '17900000000000001', 'instagram');

      expect(clients.getGraphToken).toHaveBeenCalledWith(
        CLIENT_ID,
        'instagram',
      );
      expect(postComments.listUnreplied).toHaveBeenCalledWith(
        'instagram',
        IG,
        '17900000000000001',
        igAuth,
      );
    });

    it('refuses a Facebook post of another page without calling Meta', async () => {
      const thrown = await service
        .unrepliedCount(CLIENT_ID, '99999_12345', 'facebook')
        .catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(NotFoundException);
      expect(errorBody(thrown)).toMatchObject({
        errorCode: 'META_POST_NOT_FOUND',
      });
      expect(postComments.listUnreplied).not.toHaveBeenCalled();
      expect(clients.getGraphToken).not.toHaveBeenCalled();
    });

    it('does not accept a bare post id that only starts with the same digits', async () => {
      // `${PAGE}9_1` starts with PAGE but is another page's post
      await expect(
        service.unrepliedCount(CLIENT_ID, `${PAGE}9_12345`, 'facebook'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(postComments.listUnreplied).not.toHaveBeenCalled();
    });

    it('404s with ACCOUNT_NOT_CONNECTED for a platform the client does not have', async () => {
      clients.findById.mockResolvedValue({
        id: CLIENT_ID,
        fbPageId: null,
        instaAccountId: IG,
      });
      const thrown = await service
        .unrepliedCount(CLIENT_ID, `${PAGE}_900`, 'facebook')
        .catch((e: unknown) => e);
      expect(errorBody(thrown)).toMatchObject({
        errorCode: 'ACCOUNT_NOT_CONNECTED',
      });
    });

    it('maps a post that Meta cannot find (100) to META_POST_NOT_FOUND', async () => {
      postComments.listUnreplied.mockRejectedValue(
        new GraphError('Graph 400', false, 100, 33),
      );
      const thrown = await service
        .unrepliedCount(CLIENT_ID, `${PAGE}_900`, 'facebook')
        .catch((e: unknown) => e);
      expect(thrown).toBeInstanceOf(NotFoundException);
      expect(errorBody(thrown)).toMatchObject({
        errorCode: 'META_POST_NOT_FOUND',
      });
    });

    it('maps an expired token and an outage like the list does', async () => {
      postComments.listUnreplied.mockRejectedValueOnce(
        new GraphError('x', false, 190),
      );
      await expect(
        service.unrepliedCount(CLIENT_ID, `${PAGE}_900`, 'facebook'),
      ).rejects.toBeInstanceOf(BadRequestException);

      postComments.listUnreplied.mockRejectedValueOnce(
        new GraphError('x', true, 2),
      );
      await expect(
        service.unrepliedCount(CLIENT_ID, `${PAGE}_900`, 'facebook'),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('400s when the client has no access token', async () => {
      clients.getGraphToken.mockResolvedValue(null);
      await expect(
        service.unrepliedCount(CLIENT_ID, `${PAGE}_900`, 'facebook'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
