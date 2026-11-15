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
import { createChatClient, flushRedis } from './utils/chat-e2e';

const ROWS = 10_000;
const LIMIT_MS = 2_000;

describe('List performance with 10,000 rows (SC-006)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  const timed = async (path: string) => {
    const start = performance.now();
    const res = await request(app.getHttpServer()).get(path).set(bearer(token));
    return {
      status: res.status,
      ms: performance.now() - start,
      body: res.body as { meta: { total: number } },
    };
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushRedis(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    token = (await login(app, 'admin@e2e.test')).token;
    const clientId = (await createChatClient(app, { fbPageId: 'page-perf' }))
      .id;

    const chatIds = Array.from({ length: ROWS }, () => randomUUID());
    const base = Date.UTC(2026, 0, 1);
    for (let start = 0; start < ROWS; start += 2_500) {
      const slice = chatIds.slice(start, start + 2_500);
      await prisma.chat.createMany({
        data: slice.map((id, i) => ({
          id,
          clientId,
          platform: 'FACEBOOK' as const,
          senderId: `psid-${start + i}`,
          receiverId: 'page-perf',
          createdAt: new Date(base + (start + i) * 1000),
          updatedAt: new Date(base + (start + i) * 1000),
        })),
      });
      await prisma.messageReply.createMany({
        data: slice.map((chatId, i) => ({
          chatId,
          message: `message ${start + i}`,
          reply: `reply ${start + i}`,
          createdAt: new Date(base + (start + i) * 1000),
        })),
      });
      await prisma.commentReply.createMany({
        data: slice.map((_, i) => ({
          clientId,
          platform: 'FACEBOOK' as const,
          commentId: `perf_${start + i}`,
          comment: `comment ${start + i}`,
          classification: 'INQUIRY' as const,
          reason: 'keyword',
          createdAt: new Date(base + (start + i) * 1000),
        })),
      });
    }
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['conversations', '/chats?limit=20'],
    ['conversations, paused filter', '/chats?limit=20&paused=false'],
    ['conversations, customer search', '/chats?senderId=psid-9999'],
    ['classified comments', '/comment-replies?limit=20'],
    [
      'classified comments, label and basis filters',
      '/comment-replies?classification=inquiry&decisionBasis=unknown&limit=20',
    ],
  ])('the first page of %s appears in under 2 seconds', async (_name, path) => {
    await timed(path); // the first request warms the connection pool
    const result = await timed(path);

    expect(result.status).toBe(200);
    expect(result.ms).toBeLessThan(LIMIT_MS);
  });

  it('reports the true total without loading every row', async () => {
    const chats = await timed('/chats?limit=20');
    const comments = await timed('/comment-replies?limit=20');
    expect(chats.body.meta.total).toBe(ROWS);
    expect(comments.body.meta.total).toBe(ROWS);
  });
});
