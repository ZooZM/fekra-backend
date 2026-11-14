import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { PrismaService } from '../src/prisma/prisma.service';
import {
  bearer,
  createE2eApp,
  createUser,
  login,
  resetDb,
} from './utils/e2e-app';
import {
  createChatClient,
  createClientUser,
  flushRedis,
} from './utils/chat-e2e';

interface Comment {
  commentId: string;
  clientName: string;
  classification: string;
  decisionBasis: string;
  decisionModel: string | null;
  comment: string;
}
interface Page {
  data: Comment[];
  meta: { total: number };
  errorCode?: string;
  details?: { fieldErrors?: Record<string, string[]> };
}

describe('Classified comments list (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let ownerToken: string;
  let clientA: string;
  let clientB: string;

  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer()).get(path).set(bearer(token));

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushRedis(app);

    clientA = (
      await createChatClient(app, { fbPageId: 'page-a', name: 'Acme' })
    ).id;
    clientB = (
      await createChatClient(app, { fbPageId: 'page-b', name: 'Beta' })
    ).id;
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    await createClientUser(prisma, 'owner@e2e.test', clientA);
    adminToken = (await login(app, 'admin@e2e.test')).token;
    ownerToken = (await login(app, 'owner@e2e.test')).token;

    const row = (
      clientId: string,
      n: number,
      classification: 'INQUIRY' | 'COMPLAINT' | 'SPAM' | 'ENGAGEMENT',
      decisionBasis: 'RULES' | 'AI_MODEL' | 'SAFE_FALLBACK' | 'UNKNOWN',
      day: number,
      decisionModel: string | null = null,
      comment = `comment ${n}`,
    ) => ({
      clientId,
      platform: 'FACEBOOK' as const,
      commentId: `100_${n}`,
      comment,
      classification,
      reason: 'test',
      decisionBasis,
      decisionModel,
      createdAt: new Date(Date.UTC(2026, 10, day, 10)),
    });
    await prisma.commentReply.createMany({
      data: [
        row(clientA, 1, 'INQUIRY', 'RULES', 1),
        row(clientA, 2, 'COMPLAINT', 'AI_MODEL', 2, 'gemini-3.5-flash-lite'),
        row(clientA, 3, 'SPAM', 'SAFE_FALLBACK', 3),
        row(clientA, 4, 'SPAM', 'RULES', 4),
        row(clientA, 5, 'ENGAGEMENT', 'UNKNOWN', 5, null, ''), // a sticker: no text
        row(clientB, 6, 'COMPLAINT', 'AI_MODEL', 6, 'gemini-3.8-flash'),
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 without a token', async () => {
    await request(app.getHttpServer()).get('/comment-replies').expect(401);
  });

  it('lists every client newest first, each with the client name and how it was decided', async () => {
    const body = (await get('/comment-replies').expect(200)).body as Page;

    expect(body.meta.total).toBe(6);
    expect(body.data.map((c) => c.commentId)).toEqual([
      '100_6',
      '100_5',
      '100_4',
      '100_3',
      '100_2',
      '100_1',
    ]);
    expect(body.data[0]).toMatchObject({
      clientName: 'Beta',
      decisionBasis: 'AI_MODEL',
      decisionModel: 'gemini-3.8-flash',
    });
  });

  it('keeps a comment with no text', async () => {
    const body = (
      await get('/comment-replies?classification=engagement').expect(200)
    ).body as Page;
    expect(body.data).toHaveLength(1);
    expect(body.data[0].comment).toBe('');
  });

  it.each([
    ['classification=complaint', 2],
    ['classification=SPAM', 2],
    ['decisionBasis=ai_model', 2],
    ['decisionBasis=safe_fallback', 1],
    ['decisionBasis=unknown', 1],
    ['classification=spam&decisionBasis=rules', 1],
    ['platform=instagram', 0],
  ])('filters by %s and counts only the matches', async (query, total) => {
    const body = (await get(`/comment-replies?${query}`).expect(200))
      .body as Page;
    expect(body.meta.total).toBe(total);
    expect(body.data).toHaveLength(total);
  });

  it('keeps a fallback label apart from a real spam verdict', async () => {
    const real = (
      await get(
        '/comment-replies?classification=spam&decisionBasis=rules',
      ).expect(200)
    ).body as Page;
    const fallback = (
      await get(
        '/comment-replies?classification=spam&decisionBasis=safe_fallback',
      ).expect(200)
    ).body as Page;
    expect(real.data.map((c) => c.commentId)).toEqual(['100_4']);
    expect(fallback.data.map((c) => c.commentId)).toEqual(['100_3']);
  });

  it('filters by client and by date range', async () => {
    const byClient = (
      await get(`/comment-replies?clientId=${clientB}`).expect(200)
    ).body as Page;
    expect(byClient.data.map((c) => c.commentId)).toEqual(['100_6']);

    const range = (
      await get(
        '/comment-replies?from=2026-11-02&to=2026-11-03T23:59:59Z',
      ).expect(200)
    ).body as Page;
    expect(range.data.map((c) => c.commentId).sort()).toEqual([
      '100_2',
      '100_3',
    ]);
  });

  it('refuses an end date before the start date, on the end date field', async () => {
    const res = await get(
      '/comment-replies?from=2026-11-10&to=2026-11-01',
    ).expect(422);
    const body = res.body as Page;
    expect(body.errorCode).toBe('INPUT_VALIDATION_ERROR');
    expect(body.details?.fieldErrors?.to).toBeDefined();
  });

  it('refuses an unknown decision basis', async () => {
    await get('/comment-replies?decisionBasis=guess').expect(422);
  });

  it('shows a CLIENT-role user only their own client, whatever clientId they ask for', async () => {
    const body = (
      await get(`/comment-replies?clientId=${clientB}`, ownerToken).expect(200)
    ).body as Page;
    expect(body.meta.total).toBe(5);
    expect(body.data.every((c) => c.clientName === 'Acme')).toBe(true);
  });
});
