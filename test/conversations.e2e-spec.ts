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

interface Chat {
  id: string;
  clientId: string;
  clientName: string;
  platform: string;
  senderId: string;
  paused: boolean;
  lastExchange: {
    message: string;
    reply: string;
    answered: boolean;
  } | null;
}
interface Page<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

describe('Conversations API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let ownerToken: string;
  let clientA: string;
  let clientB: string;
  let chatA1: string;
  let chatA2: string;
  let chatB: string;

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

    const chat = (
      clientId: string,
      senderId: string,
      receiverId: string,
      at: Date,
    ) =>
      prisma.chat.create({
        data: {
          clientId,
          platform: 'FACEBOOK',
          senderId,
          receiverId,
          createdAt: at,
          updatedAt: at,
        },
      });
    chatA1 = (
      await chat(clientA, 'psid-1', 'page-a', new Date('2026-11-10T10:00:00Z'))
    ).id;
    chatA2 = (
      await chat(clientA, 'psid-2', 'page-a', new Date('2026-11-12T10:00:00Z'))
    ).id;
    chatB = (
      await chat(clientB, 'psid-3', 'page-b', new Date('2026-11-11T10:00:00Z'))
    ).id;

    // chat A1: 50 exchanges, the newest with a long message; chat B: one; chat A2: none
    const base = new Date('2026-11-10T10:00:00Z').getTime();
    await prisma.messageReply.createMany({
      data: Array.from({ length: 50 }, (_, i) => ({
        chatId: chatA1,
        message: i === 49 ? 'x'.repeat(300) : `message ${i}`,
        reply: `reply ${i}`,
        createdAt: new Date(base + i * 60_000),
      })),
    });
    await prisma.messageReply.create({
      data: { chatId: chatB, message: 'from B', reply: 'to B' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers 401 without a token', async () => {
    await request(app.getHttpServer()).get('/chats').expect(401);
    await request(app.getHttpServer()).get(`/chats/${chatA1}`).expect(401);
  });

  it('lists every client conversation for an ADMIN, most recent activity first, with the preview', async () => {
    const res = await get('/chats').expect(200);
    const body = res.body as Page<Chat>;

    expect(body.meta.total).toBe(3);
    expect(body.data.map((c) => c.id)).toEqual([chatA2, chatB, chatA1]);
    const a1 = body.data.find((c) => c.id === chatA1)!;
    expect(a1.clientName).toBe('Acme');
    expect(a1.paused).toBe(false);
    expect(a1.lastExchange?.reply).toBe('reply 49');
    expect(a1.lastExchange?.message).toHaveLength(200); // cut for the preview
    expect(a1.lastExchange?.answered).toBe(true);
  });

  it('gives a conversation with no exchange a null last exchange', async () => {
    const res = await get(`/chats/${chatA2}`).expect(200);
    expect((res.body as Chat).lastExchange).toBeNull();
  });

  it('searches by the whole customer identifier, ignoring spaces around it', async () => {
    const hit = await get(
      `/chats?senderId=${encodeURIComponent('  psid-3  ')}`,
    ).expect(200);
    expect((hit.body as Page<Chat>).data.map((c) => c.id)).toEqual([chatB]);

    const partial = await get('/chats?senderId=psid').expect(200);
    expect((partial.body as Page<Chat>).data).toEqual([]);
    expect((partial.body as Page<Chat>).meta.total).toBe(0);
  });

  it('filters by platform and by client', async () => {
    const instagram = await get('/chats?platform=instagram').expect(200);
    expect((instagram.body as Page<Chat>).meta.total).toBe(0);

    const byClient = await get(`/chats?clientId=${clientB}`).expect(200);
    expect((byClient.body as Page<Chat>).data.map((c) => c.id)).toEqual([
      chatB,
    ]);
  });

  it('shows a CLIENT-role user only their own client, whatever clientId they ask for', async () => {
    const res = await get(`/chats?clientId=${clientB}`, ownerToken).expect(200);
    const ids = (res.body as Page<Chat>).data.map((c) => c.id);
    expect(ids.sort()).toEqual([chatA1, chatA2].sort());
  });

  it('answers 404 for another client conversation, and does not reveal it exists', async () => {
    await get(`/chats/${chatB}`, ownerToken).expect(404);
    await get(`/chats/${chatB}/messages`, ownerToken).expect(404);
    await get(`/chats/${chatA1}`, ownerToken).expect(200);
  });

  it('never shows a CLIENT-role user who paused a conversation', async () => {
    await prisma.chat.update({
      where: { id: chatA2 },
      data: {
        pausedAt: new Date(),
        pausedUntil: null,
        pausedById: '00000000-0000-4000-8000-000000000001',
        pausedByName: 'Admin One',
      },
    });

    const asClient = (await get(`/chats/${chatA2}`, ownerToken).expect(200))
      .body as { paused: boolean; pausedBy: unknown };
    const asAdmin = (await get(`/chats/${chatA2}`).expect(200)).body as {
      pausedBy: { name: string };
    };
    expect(asClient.paused).toBe(true);
    expect(asClient.pausedBy).toBeNull();
    expect(asAdmin.pausedBy.name).toBe('Admin One');

    await prisma.chat.update({
      where: { id: chatA2 },
      data: { pausedAt: null, pausedById: null, pausedByName: null },
    });
  });

  it('answers 422 for a malformed id or filter', async () => {
    await get('/chats/not-a-uuid').expect(422);
    await get('/chats?paused=yes').expect(422);
  });

  it('returns the 50 exchanges of a conversation in order with the exact text (SC-002)', async () => {
    const res = await get(
      `/chats/${chatA1}/messages?orderDir=asc&limit=100`,
    ).expect(200);
    const body = res.body as Page<{
      message: string;
      reply: string;
      answered: boolean;
    }>;

    expect(body.meta.total).toBe(50);
    expect(body.data.map((e) => e.reply)).toEqual(
      Array.from({ length: 50 }, (_, i) => `reply ${i}`),
    );
    expect(body.data[0].message).toBe('message 0');
    expect(body.data[49].message).toHaveLength(300); // the full text, not the preview
    expect(body.data.every((e) => e.answered)).toBe(true);
  });

  it('pages the newest exchanges first by default', async () => {
    const res = await get(`/chats/${chatA1}/messages?limit=20`).expect(200);
    const body = res.body as Page<{ reply: string }>;
    expect(body.data).toHaveLength(20);
    expect(body.data[0].reply).toBe('reply 49');
    expect(body.meta.totalPages).toBe(3);
  });
});
