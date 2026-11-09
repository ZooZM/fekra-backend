import { ConfigService } from '@nestjs/config';
import { GraphApiService, GraphError } from './graph-api.service';
import { isAccessError, PostCommentsService } from './post-comments.service';

const HOST = 'https://graph.test';
const PAGE = '11111111111';
const IG = '22222222222';
const POST = `${PAGE}_33333333333`;
const TOKEN = 'token';

describe('PostCommentsService', () => {
  let service: PostCommentsService;
  let graph: {
    host: jest.Mock;
    get: jest.Mock<Promise<unknown>, [string, string]>;
  };
  let env: Record<string, string>;

  beforeEach(() => {
    env = {};
    graph = {
      host: jest.fn().mockReturnValue(HOST),
      get: jest.fn<Promise<unknown>, [string, string]>(),
    };
    service = new PostCommentsService(
      graph as unknown as GraphApiService,
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

    it('keeps only comments the page has not replied to, newest first', async () => {
      const result = await service.listUnreplied('facebook', PAGE, POST, TOKEN);

      expect(result.checked).toBe(5);
      expect(result.unreplied.map((c) => c.id)).toEqual(['new', 'old']);
      expect(result.truncated).toBe(false);
    });

    it('counts a comment that only another customer replied to as unreplied', async () => {
      const { unreplied } = await service.listUnreplied(
        'facebook',
        PAGE,
        POST,
        TOKEN,
      );
      expect(unreplied.find((c) => c.id === 'new')?.replierIds).toEqual(['u3']);
    });

    it('requests top-level comments with their replies through graph.facebook.com', async () => {
      await service.listUnreplied('facebook', PAGE, POST, TOKEN);

      expect(graph.host).toHaveBeenCalledWith('facebook');
      expect(graph.get.mock.calls[0][1]).toBe(TOKEN);
      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.pathname).toBe(`/${POST}/comments`);
      expect(url.searchParams.get('filter')).toBe('toplevel');
      expect(url.searchParams.get('fields')).toContain('comments');
      expect(url.searchParams.get('fields')).toContain('is_hidden');
    });
  });

  // ─────────────────────────── Instagram ───────────────────────────

  describe('Instagram', () => {
    it('uses the Instagram fields and drops empty, hidden and answered comments', async () => {
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

      const { checked, unreplied } = await service.listUnreplied(
        'instagram',
        IG,
        '444444',
        TOKEN,
      );

      expect(checked).toBe(4);
      expect(unreplied.map((c) => c.id)).toEqual(['ig-1']);
      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.searchParams.get('fields')).toContain('replies');
    });
  });

  // ─────────────────────────── pagination and the limit ───────────────────────────

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

      const result = await service.listUnreplied('facebook', PAGE, POST, TOKEN);

      expect(graph.get).toHaveBeenCalledTimes(2);
      expect(graph.get.mock.calls[1][0]).toBe(`${HOST}/next-page`);
      expect(result.checked).toBe(2);
      expect(result.truncated).toBe(false);
    });

    it('stops at COMMENT_BACKFILL_MAX and reports the result as truncated', async () => {
      env.COMMENT_BACKFILL_MAX = '3';
      graph.get.mockResolvedValue({
        data: [1, 2].map((n) => ({ id: `c${n}`, from: { id: 'u' } })),
        paging: { next: `${HOST}/more` },
      });

      const result = await service.listUnreplied('facebook', PAGE, POST, TOKEN);

      expect(graph.get).toHaveBeenCalledTimes(2);
      expect(result.checked).toBe(3);
      expect(result.truncated).toBe(true);
    });

    it('is not truncated when the last page ends exactly at the limit', async () => {
      env.COMMENT_BACKFILL_MAX = '2';
      graph.get.mockResolvedValueOnce({
        data: [1, 2].map((n) => ({ id: `c${n}`, from: { id: 'u' } })),
      });

      const result = await service.listUnreplied('facebook', PAGE, POST, TOKEN);

      expect(result.checked).toBe(2);
      expect(result.truncated).toBe(false);
    });

    it('defaults the limit to 500', async () => {
      graph.get.mockResolvedValueOnce({
        data: Array.from({ length: 501 }, (_, n) => ({
          id: `c${n}`,
          from: { id: 'u' },
        })),
      });

      const result = await service.listUnreplied('facebook', PAGE, POST, TOKEN);

      expect(result.checked).toBe(500);
      expect(result.truncated).toBe(true);
    });
  });

  it('passes Graph errors through so callers can map them', async () => {
    graph.get.mockRejectedValueOnce(new Error('Graph 400'));
    await expect(
      service.listUnreplied('facebook', PAGE, POST, TOKEN),
    ).rejects.toThrow('Graph 400');
  });

  // ─────────────────────────── recheck ───────────────────────────

  describe('recheck', () => {
    const recheck = (platform: 'facebook' | 'instagram' = 'facebook') =>
      service.recheck(
        platform,
        platform === 'facebook' ? PAGE : IG,
        'comment-1',
        TOKEN,
      );

    it('reads one comment with its replies, through graph.facebook.com', async () => {
      graph.get.mockResolvedValueOnce({ id: 'comment-1' });
      await recheck('facebook');

      expect(graph.host).toHaveBeenCalledWith('facebook');
      expect(graph.get.mock.calls[0][1]).toBe(TOKEN);
      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.pathname).toBe('/comment-1');
      expect(url.searchParams.get('fields')).toBe(
        'id,is_hidden,comments.limit(100){from{id}}',
      );
    });

    it('asks for the Instagram fields on Instagram', async () => {
      graph.get.mockResolvedValueOnce({ id: 'comment-1' });
      await recheck('instagram');
      const url = new URL(graph.get.mock.calls[0][0]);
      expect(url.searchParams.get('fields')).toBe(
        'id,hidden,replies.limit(50){from{id}}',
      );
    });

    it('needs_reply when it is still visible and the page has not replied', async () => {
      graph.get.mockResolvedValueOnce({
        id: 'comment-1',
        comments: { data: [{ from: { id: 'a-friend' } }] },
      });
      await expect(recheck()).resolves.toBe('needs_reply');
    });

    it('answered when the page replied since the run started', async () => {
      graph.get.mockResolvedValueOnce({
        id: 'comment-1',
        comments: {
          data: [{ from: { id: 'a-friend' } }, { from: { id: PAGE } }],
        },
      });
      await expect(recheck()).resolves.toBe('answered');
    });

    it('answered on Instagram when the account replied', async () => {
      graph.get.mockResolvedValueOnce({
        id: 'comment-1',
        replies: { data: [{ from: { id: IG } }] },
      });
      await expect(recheck('instagram')).resolves.toBe('answered');
    });

    it('hidden when a moderator hid it, on both platforms', async () => {
      graph.get.mockResolvedValueOnce({ id: 'comment-1', is_hidden: true });
      await expect(recheck('facebook')).resolves.toBe('hidden');
      graph.get.mockResolvedValueOnce({ id: 'comment-1', hidden: true });
      await expect(recheck('instagram')).resolves.toBe('hidden');
    });

    it('hidden wins over a page reply: nothing is left to do either way', async () => {
      graph.get.mockResolvedValueOnce({
        id: 'comment-1',
        is_hidden: true,
        comments: { data: [{ from: { id: PAGE } }] },
      });
      await expect(recheck()).resolves.toBe('hidden');
    });

    it.each([100, 803])(
      'deleted when Meta says the comment does not exist (code %i)',
      async (code) => {
        graph.get.mockRejectedValueOnce(
          new GraphError('gone', false, code, 33),
        );
        await expect(recheck()).resolves.toBe('deleted');
      },
    );

    it('check_failed on a temporary Meta failure, so the comment is skipped, not answered', async () => {
      graph.get.mockRejectedValueOnce(new GraphError('Graph 500', true, 2));
      await expect(recheck()).resolves.toBe('check_failed');
    });

    it('check_failed on any other Meta rejection', async () => {
      graph.get.mockRejectedValueOnce(new GraphError('Graph 400', false, 1234));
      await expect(recheck()).resolves.toBe('check_failed');
    });

    it.each([190, 10, 200, 299])(
      'throws when the token is rejected (code %i)',
      async (code) => {
        const err = new GraphError('denied', false, code);
        graph.get.mockRejectedValueOnce(err);
        await expect(recheck()).rejects.toBe(err);
      },
    );

    it('lets an error that is not from Meta through', async () => {
      graph.get.mockRejectedValueOnce(new TypeError('bug'));
      await expect(recheck()).rejects.toThrow('bug');
    });
  });

  describe('isAccessError', () => {
    it.each([190, 10, 200, 250, 299])('is true for code %i', (code) => {
      expect(isAccessError(new GraphError('x', false, code))).toBe(true);
    });

    it.each([undefined, 1, 2, 100, 199, 300, 803])(
      'is false for code %s',
      (code) => {
        expect(isAccessError(new GraphError('x', false, code))).toBe(false);
      },
    );

    it('is false for anything that is not a GraphError', () => {
      expect(isAccessError(new Error('190'))).toBe(false);
      expect(isAccessError(undefined)).toBe(false);
    });
  });
});
