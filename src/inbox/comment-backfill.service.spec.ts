import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsService } from '@app/clients/clients.service';
import { CommentBackfillService } from './comment-backfill.service';
import { GraphApiService, GraphError } from './graph-api.service';
import { PriorityInboxService } from './priority-inbox.service';
import { InboxItem } from './inbox.types';

const HOST = 'https://graph.test';
const PAGE = '11111111111';
const IG = '22222222222';
const POST = `${PAGE}_33333333333`;

/** Lets the background feed loop run to completion (delay is 0 in tests). */
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
};

describe('CommentBackfillService', () => {
  let service: CommentBackfillService;
  let graph: { host: jest.Mock; get: jest.Mock<Promise<unknown>, [string]> };
  let clients: {
    getClientDataForWorkFlow: jest.Mock;
    getAccessToken: jest.Mock;
  };
  let inbox: {
    push: jest.Mock<Promise<boolean>, [InboxItem, { skipRateLimit?: boolean }]>;
  };
  let env: Record<string, string>;

  const pushed = () => inbox.push.mock.calls.map(([item]) => item);

  beforeEach(() => {
    env = { COMMENT_BACKFILL_DELAY_MS: '0' };
    graph = {
      host: jest.fn().mockReturnValue(HOST),
      get: jest.fn<Promise<unknown>, [string]>(),
    };
    clients = {
      getClientDataForWorkFlow: jest.fn().mockResolvedValue({
        id: 'client-1',
        fbPageId: PAGE,
        instaAccountId: IG,
      }),
      getAccessToken: jest.fn().mockResolvedValue('token'),
    };
    inbox = {
      push: jest
        .fn<Promise<boolean>, [InboxItem, { skipRateLimit?: boolean }]>()
        .mockResolvedValue(true),
    };
    service = new CommentBackfillService(
      graph as unknown as GraphApiService,
      clients as unknown as ClientsService,
      inbox as unknown as PriorityInboxService,
      { get: (k: string) => env[k] } as unknown as ConfigService,
    );
  });

  // ─────────────────────────── Facebook ───────────────────────────

  describe('Facebook', () => {
    beforeEach(() => {
      graph.get.mockResolvedValueOnce({
        data: [
          {
            id: 'old',
            message: 'بكام',
            created_time: '2026-01-01T10:00:00+0000',
            from: { id: 'u1' },
          },
          {
            id: 'new',
            message: 'تحفة',
            created_time: '2026-03-01T10:00:00+0000',
            from: { id: 'u2' },
            comments: { data: [{ from: { id: 'u3' } }] }, // a friend replied, not the page
          },
          {
            id: 'answered',
            message: 'فين',
            created_time: '2026-02-01T10:00:00+0000',
            from: { id: 'u4' },
            comments: { data: [{ from: { id: PAGE } }] },
          },
          { id: 'own', message: 'post by page', from: { id: PAGE } },
          {
            id: 'hidden',
            message: 'spam',
            is_hidden: true,
            from: { id: 'u5' },
          },
        ],
      });
    });

    it('queues only comments the page has not replied to, newest first', async () => {
      const result = await service.start({ accountId: PAGE, postId: POST });
      await flush();

      expect(result).toEqual({
        platform: 'facebook',
        postId: POST,
        total: 5,
        pending: 2,
        delaySeconds: 0,
      });
      expect(pushed().map((i) => i.id)).toEqual(['new', 'old']);
    });

    it('pushes the same item shape as the live webhook, without the rate limit', async () => {
      await service.start({ accountId: PAGE, postId: POST });
      await flush();

      const [item, opts] = inbox.push.mock.calls[1];
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

    it('requests top-level comments with their replies through graph.facebook.com', async () => {
      await service.start({ accountId: PAGE, postId: POST });

      expect(graph.host).toHaveBeenCalledWith('facebook');
      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.pathname).toBe(`/${POST}/comments`);
      expect(url.searchParams.get('filter')).toBe('toplevel');
      expect(url.searchParams.get('fields')).toContain('comments');
      expect(url.searchParams.get('fields')).toContain('is_hidden');
    });
  });

  // ─────────────────────────── Instagram ───────────────────────────

  describe('Instagram', () => {
    it('detects Instagram from the account ID and uses the Instagram fields', async () => {
      graph.get.mockResolvedValueOnce({
        data: [
          {
            id: 'ig-1',
            text: 'price?',
            timestamp: '2026-01-01T10:00:00+0000',
            from: { id: 'u1' },
          },
          { id: 'ig-empty', text: '', from: { id: 'u2' } },
          {
            id: 'ig-answered',
            text: 'hi',
            from: { id: 'u3' },
            replies: { data: [{ from: { id: IG } }] },
          },
          { id: 'ig-hidden', text: 'x', hidden: true, from: { id: 'u4' } },
        ],
      });

      const result = await service.start({ accountId: IG, postId: '444444' });
      await flush();

      expect(result.platform).toBe('instagram');
      expect(pushed().map((i) => [i.id, i.platform])).toEqual([
        ['ig-1', 'instagram'],
      ]);
      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.searchParams.get('fields')).toContain('replies');
    });
  });

  // ─────────────────────────── pagination ───────────────────────────

  describe('pagination', () => {
    it('follows paging.next until the end', async () => {
      graph.get
        .mockResolvedValueOnce({
          data: [{ id: 'a', message: 'x', from: { id: 'u1' } }],
          paging: { next: `${HOST}/next-page` },
        })
        .mockResolvedValueOnce({
          data: [{ id: 'b', message: 'y', from: { id: 'u2' } }],
        });

      const result = await service.start({ accountId: PAGE, postId: POST });

      expect(graph.get).toHaveBeenCalledTimes(2);
      expect(graph.get.mock.calls[1][0]).toBe(`${HOST}/next-page`);
      expect(result.total).toBe(2);
    });

    it('stops at COMMENT_BACKFILL_MAX', async () => {
      env.COMMENT_BACKFILL_MAX = '3';
      graph.get.mockResolvedValue({
        data: [1, 2].map((n) => ({ id: `c${n}`, from: { id: 'u' } })),
        paging: { next: `${HOST}/more` },
      });

      const result = await service.start({ accountId: PAGE, postId: POST });

      expect(graph.get).toHaveBeenCalledTimes(2);
      expect(result.total).toBe(3);
    });
  });

  // ─────────────────────────── errors and concurrency ───────────────────────────

  describe('errors and concurrency', () => {
    it('404s when no client owns the account', async () => {
      clients.getClientDataForWorkFlow.mockResolvedValue(null);
      await expect(
        service.start({ accountId: PAGE, postId: POST }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('400s when the client has no access token', async () => {
      clients.getAccessToken.mockResolvedValue(null);
      await expect(
        service.start({ accountId: PAGE, postId: POST }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a second run on the same post until the first one ends', async () => {
      env.COMMENT_BACKFILL_DELAY_MS = '50';
      graph.get.mockResolvedValue({
        data: [
          { id: 'a', message: 'x', from: { id: 'u1' } },
          { id: 'b', message: 'y', from: { id: 'u2' } },
        ],
      });

      await service.start({ accountId: PAGE, postId: POST });
      await expect(
        service.start({ accountId: PAGE, postId: POST }),
      ).rejects.toBeInstanceOf(ConflictException);

      await new Promise((r) => setTimeout(r, 120));
      await expect(
        service.start({ accountId: PAGE, postId: POST }),
      ).resolves.toMatchObject({ pending: 2 });
    });

    it('releases the post when fetching the comments fails', async () => {
      graph.get.mockRejectedValueOnce(new Error('Graph 400'));
      await expect(
        service.start({ accountId: PAGE, postId: POST }),
      ).rejects.toThrow('Graph 400');

      graph.get.mockResolvedValueOnce({ data: [] });
      await expect(
        service.start({ accountId: PAGE, postId: POST }),
      ).resolves.toMatchObject({ total: 0 });
    });

    describe('Meta errors become clear HTTP errors, not a 500', () => {
      const fail = (err: GraphError) => {
        graph.get.mockRejectedValueOnce(err);
        return service.start({ accountId: PAGE, postId: POST });
      };

      it('404 for a post that does not exist on the page (code 100 / 33)', async () => {
        // the exact error from a wrong post id
        const err = new GraphError(
          "Graph 400 code=100 sub=33: Unsupported get request. Object with ID '114022207011543_100068101366873' does not exist",
          false,
          100,
          33,
        );
        const thrown = await fail(err).catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(NotFoundException);
        expect((thrown as NotFoundException).getResponse()).toMatchObject({
          errorCode: 'META_POST_NOT_FOUND',
          details: { graphCode: 100, graphSubcode: 33 },
        });
        expect((thrown as Error).message).toContain(POST);
      });

      it('400 for an invalid or expired token (code 190)', async () => {
        const thrown = await fail(
          new GraphError('Graph 400 code=190', false, 190, 463),
        ).catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(BadRequestException);
        expect((thrown as BadRequestException).getResponse()).toMatchObject({
          errorCode: 'META_TOKEN_INVALID',
        });
      });

      it('400 for a missing permission (code 10 / 2xx)', async () => {
        const thrown = await fail(
          new GraphError('Graph 403 code=200', false, 200),
        ).catch((e: unknown) => e);
        expect((thrown as BadRequestException).getResponse()).toMatchObject({
          errorCode: 'META_PERMISSION_DENIED',
        });
      });

      it('503 when Meta is still unavailable after the retries', async () => {
        const thrown = await fail(new GraphError('Graph 500', true, 2)).catch(
          (e: unknown) => e,
        );
        expect(thrown).toBeInstanceOf(ServiceUnavailableException);
      });

      it('502 for any other Meta rejection', async () => {
        const thrown = await fail(
          new GraphError('Graph 400 code=1234', false, 1234),
        ).catch((e: unknown) => e);
        expect(thrown).toBeInstanceOf(BadGatewayException);
      });

      it('releases the post after a Meta error, so it can be retried', async () => {
        await fail(new GraphError('x', false, 100, 33)).catch(() => undefined);
        graph.get.mockResolvedValueOnce({ data: [] });
        await expect(
          service.start({ accountId: PAGE, postId: POST }),
        ).resolves.toMatchObject({ total: 0 });
      });
    });

    it('stops feeding when the app shuts down', async () => {
      env.COMMENT_BACKFILL_DELAY_MS = '30';
      graph.get.mockResolvedValue({
        data: ['a', 'b', 'c'].map((id) => ({ id, from: { id: 'u' } })),
      });

      await service.start({ accountId: PAGE, postId: POST });
      await flush();
      service.onModuleDestroy();
      await new Promise((r) => setTimeout(r, 100));

      expect(inbox.push).toHaveBeenCalledTimes(1);
    });
  });
});
