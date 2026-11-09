import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '../src/prisma/prisma.service';
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
  restoreGraph,
  stubGraph,
} from './utils/graph-stub';

const PAGE = '114022207011543';
const POST = `${PAGE}_100068101366873`;
const OTHER_PAGE_POST = '999999999999_12345';

interface Body {
  data?: Record<string, unknown>[];
  meta?: Record<string, unknown>;
  errorCode?: string;
  details?: Record<string, unknown>;
  unrepliedCount?: number;
  truncated?: boolean;
  checked?: number;
}

describe('Client posts API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let clientUserToken: string;
  let clientId: string;

  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer()).get(path).set(bearer(token));

  const fbPost = (n: number) => ({
    id: `${PAGE}_${n}`,
    message: `post ${n}`,
    created_time: '2026-03-01T10:00:00+0000',
    permalink_url: `https://www.facebook.com/${PAGE}/posts/${n}`,
    comments: { data: [], summary: { total_count: n } },
  });

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushLoginFailures(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    await createUser(prisma, 'client@e2e.test', ['CLIENT']);
    adminToken = (await login(app, 'admin@e2e.test')).token;
    clientUserToken = (await login(app, 'client@e2e.test')).token;

    const created = await request(app.getHttpServer())
      .post('/clients')
      .set(bearer(adminToken))
      .send({
        name: 'Posts Client',
        businessCategory: 'Cafe',
        fbPageId: PAGE, // no Instagram account
        accessToken: 'e2e-page-token',
      })
      .expect(201);
    clientId = (created.body as { id: string }).id;
  });

  afterEach(() => restoreGraph());

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    const paths = () => [
      `/clients/${clientId}/posts?platform=facebook`,
      `/clients/${clientId}/posts/${POST}/unreplied-count?platform=facebook`,
    ];

    it('returns 401 without a token', async () => {
      for (const path of paths()) {
        await request(app.getHttpServer()).get(path).expect(401);
      }
    });

    it('returns 403 FORBIDDEN for a CLIENT-role user, without calling Meta', async () => {
      stubGraph(() => ({ body: { data: [] } }));
      for (const path of paths()) {
        const res = await get(path, clientUserToken).expect(403);
        expect((res.body as Body).errorCode).toBe('FORBIDDEN');
      }
      expect(graphCalls()).toHaveLength(0);
    });
  });

  describe('not found and validation', () => {
    it('404s for an unknown client', async () => {
      const res = await get(
        '/clients/00000000-0000-4000-8000-000000000000/posts?platform=facebook',
      ).expect(404);
      expect((res.body as Body).errorCode).toBe('NOT_FOUND');
    });

    it('404s ACCOUNT_NOT_CONNECTED for a platform the client does not have', async () => {
      stubGraph(() => ({ body: { data: [] } }));
      const res = await get(
        `/clients/${clientId}/posts?platform=instagram`,
      ).expect(404);
      expect((res.body as Body).errorCode).toBe('ACCOUNT_NOT_CONNECTED');
      expect(graphCalls()).toHaveLength(0);
    });

    it('422s a client id that is a Facebook page id', async () => {
      const res = await get(`/clients/${PAGE}/posts?platform=facebook`).expect(
        422,
      );
      expect((res.body as Body).errorCode).toBe('INPUT_VALIDATION_ERROR');
    });

    it.each([
      ['platform=x'],
      ['platform=facebook&after=a/b'],
      ['platform=facebook&after=a%26limit%3D100'],
      ['platform=facebook&limit=26'],
      ['platform=facebook&limit=0'],
      ['platform=facebook&fields=id'],
      [''],
    ])('422s the list query "%s"', async (query) => {
      const res = await get(`/clients/${clientId}/posts?${query}`).expect(422);
      expect((res.body as Body).errorCode).toBe('INPUT_VALIDATION_ERROR');
    });

    it.each(['abc', '1234', '12345_'])('422s the post id "%s"', async (id) => {
      await get(
        `/clients/${clientId}/posts/${id}/unreplied-count?platform=facebook`,
      ).expect(422);
    });
  });

  describe('list', () => {
    it('returns the mapped first page with the next cursor, then the last page', async () => {
      stubGraph((url) => {
        if (!url.pathname.endsWith(`/${PAGE}/posts`)) return undefined;
        if (url.searchParams.get('after') === 'CURSOR2') {
          return { body: { data: [fbPost(3)] } };
        }
        return {
          body: {
            data: [fbPost(1), fbPost(2)],
            paging: { cursors: { after: 'CURSOR2' }, next: 'https://x/next' },
          },
        };
      });

      const first = await get(
        `/clients/${clientId}/posts?platform=facebook&limit=2`,
      ).expect(200);
      const firstBody = first.body as Body;
      expect(firstBody.data?.map((p) => p.id)).toEqual([
        `${PAGE}_1`,
        `${PAGE}_2`,
      ]);
      expect(firstBody.data?.[1]).toMatchObject({
        platform: 'facebook',
        text: 'post 2',
        commentsCount: 2,
        publishedAt: '2026-03-01T10:00:00.000Z',
        replyRun: null, // no run has been started on it
      });
      expect(firstBody.meta).toMatchObject({ limit: 2, nextCursor: 'CURSOR2' });

      const second = await get(
        `/clients/${clientId}/posts?platform=facebook&limit=2&after=CURSOR2`,
      ).expect(200);
      const secondBody = second.body as Body;
      expect(secondBody.data?.map((p) => p.id)).toEqual([`${PAGE}_3`]);
      expect(secondBody.meta?.nextCursor).toBeNull();
    });

    it('returns an empty page for an account without posts', async () => {
      stubGraph(() => ({ body: { data: [] } }));
      const res = await get(
        `/clients/${clientId}/posts?platform=facebook`,
      ).expect(200);
      expect(res.body).toMatchObject({ data: [], meta: { nextCursor: null } });
    });

    it('never returns or sends the stored token anywhere but the Authorization header', async () => {
      let auth: string | undefined;
      stubGraph((_url, init) => {
        auth = (init?.headers as Record<string, string>)?.authorization;
        return { body: { data: [fbPost(1)] } };
      });
      const res = await get(
        `/clients/${clientId}/posts?platform=facebook`,
      ).expect(200);

      expect(auth).toBe('Bearer e2e-page-token');
      expect(JSON.stringify(res.body)).not.toContain('e2e-page-token');
      expect(
        graphCalls().every((u) => !u.href.includes('e2e-page-token')),
      ).toBe(true);
    });

    it('maps an expired token (190) to 400 META_TOKEN_INVALID', async () => {
      stubGraph(() => graphError(190, 463));
      const res = await get(
        `/clients/${clientId}/posts?platform=facebook`,
      ).expect(400);
      expect((res.body as Body).errorCode).toBe('META_TOKEN_INVALID');
    });

    it('maps a missing permission (200) to 400 META_PERMISSION_DENIED', async () => {
      stubGraph(() => graphError(200, undefined, 403));
      const res = await get(
        `/clients/${clientId}/posts?platform=facebook`,
      ).expect(400);
      expect((res.body as Body).errorCode).toBe('META_PERMISSION_DENIED');
    });

    it('maps an account Meta does not know (100) to 404 ACCOUNT_NOT_CONNECTED', async () => {
      stubGraph(() => graphError(100, 33));
      const res = await get(
        `/clients/${clientId}/posts?platform=facebook`,
      ).expect(404);
      expect((res.body as Body).errorCode).toBe('ACCOUNT_NOT_CONNECTED');
    });

    it('maps Meta being down (after the retries) to 503 META_UNAVAILABLE', async () => {
      stubGraph(() => graphError(2, undefined, 500));
      const res = await get(
        `/clients/${clientId}/posts?platform=facebook`,
      ).expect(503);
      expect((res.body as Body).errorCode).toBe('META_UNAVAILABLE');
      expect(graphCalls()).toHaveLength(3); // GraphApiService tries 3 times
    }, 20000);
  });

  describe('unreplied count', () => {
    const comment = (id: string, from: string, replyFrom?: string) => ({
      id,
      message: `comment ${id}`,
      created_time: '2026-03-01T10:00:00+0000',
      from: { id: from },
      ...(replyFrom && {
        comments: { data: [{ from: { id: replyFrom } }] },
      }),
    });

    it('counts 3 unreplied out of 12 customer comments when the page answered 9', async () => {
      const comments = [
        ...Array.from({ length: 9 }, (_, i) =>
          comment(`answered-${i}`, `user-${i}`, PAGE),
        ),
        ...Array.from({ length: 3 }, (_, i) =>
          comment(`open-${i}`, `user-open-${i}`),
        ),
      ];
      stubGraph((url) =>
        url.pathname.endsWith(`/${POST}/comments`)
          ? { body: { data: comments } }
          : undefined,
      );

      const res = await get(
        `/clients/${clientId}/posts/${POST}/unreplied-count?platform=facebook`,
      ).expect(200);

      expect(res.body).toMatchObject({
        postId: POST,
        platform: 'facebook',
        checked: 12,
        unrepliedCount: 3,
        truncated: false,
      });
    });

    it('does not count the page’s own comments, hidden comments or friend replies wrongly', async () => {
      stubGraph(() => ({
        body: {
          data: [
            comment('own', PAGE),
            { ...comment('hidden', 'u1'), is_hidden: true },
            comment('friend-replied', 'u2', 'someone-else'),
            comment('open', 'u3'),
          ],
        },
      }));

      const res = await get(
        `/clients/${clientId}/posts/${POST}/unreplied-count?platform=facebook`,
      ).expect(200);

      // friend-replied still counts: only the page's reply answers a comment
      expect((res.body as Body).unrepliedCount).toBe(2);
    });

    it('marks the result truncated when the post has more comments than the limit', async () => {
      const page = {
        data: Array.from({ length: 100 }, (_, i) => comment(`c${i}`, `u${i}`)),
        paging: { next: 'https://graph.facebook.com/next' },
      };
      stubGraph(() => ({ body: page }));

      const res = await get(
        `/clients/${clientId}/posts/${POST}/unreplied-count?platform=facebook`,
      ).expect(200);

      const body = res.body as Body;
      expect(body.truncated).toBe(true);
      expect(body.checked).toBe(500); // COMMENT_BACKFILL_MAX default
      expect(body.unrepliedCount).toBe(500);
    });

    it('404s META_POST_NOT_FOUND for another page’s post, without calling Meta', async () => {
      stubGraph(() => ({ body: { data: [] } }));
      const res = await get(
        `/clients/${clientId}/posts/${OTHER_PAGE_POST}/unreplied-count?platform=facebook`,
      ).expect(404);
      expect((res.body as Body).errorCode).toBe('META_POST_NOT_FOUND');
      expect(graphCalls()).toHaveLength(0);
    });

    it('404s META_POST_NOT_FOUND for a post Meta cannot find (100)', async () => {
      stubGraph(() => graphError(100, 33));
      const res = await get(
        `/clients/${clientId}/posts/${POST}/unreplied-count?platform=facebook`,
      ).expect(404);
      expect((res.body as Body).errorCode).toBe('META_POST_NOT_FOUND');
    });

    it('maps an expired token to 400 META_TOKEN_INVALID', async () => {
      stubGraph(() => graphError(190));
      const res = await get(
        `/clients/${clientId}/posts/${POST}/unreplied-count?platform=facebook`,
      ).expect(400);
      expect((res.body as Body).errorCode).toBe('META_TOKEN_INVALID');
    });
  });
});
