import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
  fastPipeline,
  flushRedis,
  pushComment,
  waitFor,
} from './utils/chat-e2e';
import { restoreGraph, stubGraph } from './utils/graph-stub';

// the dispatch loop is shortened for this file only (the pipeline test at the end uses it)
fastPipeline();

const HEADER =
  'id,clientId,clientName,platform,commentId,comment,classification,decisionBasis,decisionModel,reason,createdAt';

describe('Comments CSV export (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let ownerToken: string;
  let clientId: string;
  let otherClientId: string;

  const get = (path: string, token = adminToken) =>
    request(app.getHttpServer())
      .get(path)
      .set(bearer(token))
      .buffer(true)
      .parse((res, callback) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (text += chunk));
        res.on('end', () => callback(null, text));
      });
  const text = (res: request.Response) => res.body as unknown as string;
  const lines = (csv: string) => csv.split('\r\n').filter((l) => l !== '');

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushRedis(app);

    clientId = (
      await createChatClient(app, { fbPageId: 'page-x', name: 'Acme' })
    ).id;
    otherClientId = (
      await createChatClient(app, { fbPageId: 'page-y', name: 'Beta' })
    ).id;
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    await createClientUser(prisma, 'owner@e2e.test', clientId);
    adminToken = (await login(app, 'admin@e2e.test')).token;
    ownerToken = (await login(app, 'owner@e2e.test')).token;

    const row = (
      n: number,
      comment: string,
      over: Partial<{
        clientId: string;
        classification: 'COMPLAINT' | 'INQUIRY' | 'INSULT';
        decisionBasis: 'RULES' | 'AI_MODEL';
        decisionModel: string | null;
      }> = {},
    ) => ({
      clientId,
      platform: 'FACEBOOK' as const,
      commentId: `200_${n}`,
      comment,
      classification: 'COMPLAINT' as const,
      reason: 'keyword "bad"',
      decisionBasis: 'RULES' as const,
      decisionModel: null,
      createdAt: new Date(Date.UTC(2026, 10, 1, 10, n)),
      ...over,
    });
    await prisma.commentReply.createMany({
      data: [
        row(1, 'بكام السعر؟ 😍'),
        row(2, 'a, "quoted"\nsecond line'),
        row(3, '=HYPERLINK("http://evil.test","click")'),
        row(4, '@SUM(A1:A9)'),
        row(5, '', { classification: 'INQUIRY' }),
        row(6, 'from the other client', {
          clientId: otherClientId,
          decisionBasis: 'AI_MODEL',
          decisionModel: 'gemini-3.8-flash',
        }),
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access', () => {
    it('answers 401 without a token', async () => {
      await request(app.getHttpServer())
        .get('/comment-replies/export')
        .expect(401);
    });

    it('answers 403 to a CLIENT-role user, and records nothing', async () => {
      const before = await prisma.commentExportRecord.count();
      await get('/comment-replies/export', ownerToken).expect(403);
      expect(await prisma.commentExportRecord.count()).toBe(before);
    });

    it('answers 422 for an end date before the start date, and for paging or order parameters', async () => {
      await get('/comment-replies/export?from=2026-11-10&to=2026-11-01').expect(
        422,
      );
      await get('/comment-replies/export?page=2').expect(422);
      await get('/comment-replies/export?orderBy=createdAt').expect(422);
    });
  });

  describe('the file', () => {
    it('is a CSV download that starts with the byte order mark and the header row', async () => {
      const res = await get('/comment-replies/export').expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="comments-\d{8}-\d{6}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(text(res).charCodeAt(0)).toBe(0xfeff);
      expect(lines(text(res))[0].replace('﻿', '')).toBe(HEADER);
    });

    it('keeps Arabic text and emoji intact, and quotes commas, quotes and line breaks', async () => {
      const csv = text(await get('/comment-replies/export').expect(200));
      expect(csv).toContain('بكام السعر؟ 😍');
      expect(csv).toContain('"a, ""quoted""\nsecond line"');
    });

    it('never lets a spreadsheet read customer text as a formula', async () => {
      const csv = text(await get('/comment-replies/export').expect(200));
      expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
      expect(csv).toContain(`'@SUM(A1:A9)`);
      expect(csv).not.toMatch(/,=HYPERLINK/);
    });

    it('has as many rows as the list total for the same filters (SC-008)', async () => {
      for (const query of [
        '',
        'classification=complaint',
        `clientId=${otherClientId}`,
        'decisionBasis=ai_model',
        'from=2026-11-01T10:03:00Z&to=2026-11-01T10:05:00Z',
      ]) {
        const list = await request(app.getHttpServer())
          .get(`/comment-replies?${query}`)
          .set(bearer(adminToken))
          .expect(200);
        const total = (list.body as { meta: { total: number } }).meta.total;
        const csv = text(
          await get(`/comment-replies/export?${query}`).expect(200),
        );
        expect(lines(csv).length - 1).toBe(total);
      }
    });

    it('applies the decision-basis filter', async () => {
      const csv = text(
        await get('/comment-replies/export?decisionBasis=ai_model').expect(200),
      );
      expect(lines(csv)).toHaveLength(2);
      expect(csv).toContain('gemini-3.8-flash');
    });
  });

  it('records each download with who, when, the filters and the rows, and no comment text (SC-014)', async () => {
    const before = await prisma.commentExportRecord.count();
    await get('/comment-replies/export?classification=complaint').expect(200);

    const record = await waitFor(
      () =>
        prisma.commentExportRecord.findFirst({
          orderBy: { createdAt: 'desc' },
        }),
      (r) => r?.completed === true,
    );
    expect(await prisma.commentExportRecord.count()).toBe(before + 1);
    expect(record).toMatchObject({
      actorName: 'admin',
      actorEmail: 'admin@e2e.test',
      completed: true,
      rowCount: 5,
    });
    const stored = JSON.stringify(record!.filters);
    expect(stored).toContain('COMPLAINT');
    expect(stored).toContain('snapshotAt');
    expect(stored).not.toContain('HYPERLINK');
    expect(stored).not.toContain('بكام');
  });

  it('streams 100,000 comments without error and with the right row count (SC-013)', async () => {
    const total = 100_000;
    const chunk = 5_000;
    for (let start = 0; start < total; start += chunk) {
      await prisma.commentReply.createMany({
        data: Array.from({ length: chunk }, (_, i) => ({
          clientId,
          platform: 'INSTAGRAM' as const,
          commentId: `big_${start + i}`,
          comment: `comment number ${start + i}`,
          classification: 'INSULT' as const,
          reason: 'keyword',
          createdAt: new Date(Date.UTC(2026, 9, 1) + (start + i) * 1000),
        })),
      });
    }

    const csv = text(
      await get('/comment-replies/export?classification=insult').expect(200),
    );

    expect(lines(csv).length - 1).toBe(total);
    const ids = new Set(
      lines(csv)
        .slice(1)
        .map((l) => l.split(',')[4]),
    );
    expect(ids.size).toBe(total); // no row twice, none missing
    const record = await waitFor(
      () =>
        prisma.commentExportRecord.findFirst({
          orderBy: { createdAt: 'desc' },
        }),
      (r) => r?.completed === true,
    );
    expect(record?.rowCount).toBe(total);
  }, 180_000);

  describe('how the label was decided, through the real pipeline (SC-005, SC-007)', () => {
    let gemini: jest.SpyInstance;

    beforeAll(async () => {
      await createChatClient(app, {
        fbPageId: 'page-live',
        name: 'Live',
        commentRepliesOn: true,
      });
    });
    beforeEach(() => {
      // the AI model is unavailable: every call to Gemini fails
      const real = global.fetch.bind(globalThis);
      gemini = jest
        .spyOn(global, 'fetch')
        .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url,
          );
          return url.hostname.includes('generativelanguage')
            ? Promise.resolve(
                new Response('{"error":{"message":"unavailable"}}', {
                  status: 503,
                }),
              )
            : real(input, init);
        });
      stubGraph(() => ({ status: 200, body: { id: 'graph-1' } }));
    });
    afterEach(() => {
      restoreGraph(); // in reverse order: the Graph stub wraps the Gemini one
      gemini.mockRestore();
    });

    it('records RULES for a keyword comment and SAFE_FALLBACK for an ambiguous one when the model fails', async () => {
      const ruleId = `live_${randomUUID()}`;
      const unsureId = `live_${randomUUID()}`;
      await pushComment(app, {
        accountId: 'page-live',
        text: 'بكام؟',
        id: ruleId,
      });
      await pushComment(app, {
        accountId: 'page-live',
        text: 'random words here',
        id: unsureId,
      });

      const rows = await waitFor(
        () =>
          prisma.commentReply.findMany({
            where: { commentId: { in: [ruleId, unsureId] } },
          }),
        (found) => found.length === 2,
      );

      const byId = new Map(rows.map((r) => [r.commentId, r]));
      expect(byId.get(ruleId)).toMatchObject({
        classification: 'INQUIRY',
        decisionBasis: 'RULES',
        decisionModel: null,
      });
      expect(byId.get(unsureId)).toMatchObject({
        classification: 'SPAM', // the safe default, not a verdict
        decisionBasis: 'SAFE_FALLBACK',
        decisionModel: null,
      });

      // the fallback can be told apart from a real spam verdict with one filter
      const csv = text(
        await get(
          '/comment-replies/export?decisionBasis=safe_fallback&classification=spam',
        ).expect(200),
      );
      expect(csv).toContain('random words here');
      expect(csv).not.toContain('بكام؟');
    });
  });
});
