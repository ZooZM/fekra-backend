import { INestApplication } from '@nestjs/common';
import request = require('supertest');
import { ConversationsService } from '../src/conversations/conversations.service';
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
  pushDm,
  sleep,
  sweepDmBuffers,
  waitFor,
} from './utils/chat-e2e';
import { graphCalls, restoreGraph, stubGraph } from './utils/graph-stub';
import { n8nCalls, restoreN8n, stubN8n } from './utils/n8n-stub';

// the DM window and the dispatch loop are shortened for this file only
fastPipeline();

interface ChatBody {
  id: string;
  paused: boolean;
  pausedAt: string | null;
  pausedUntil: string | null;
  pausedBy: { id: string; name: string } | null;
  errorCode?: string;
}

describe('Pausing the assistant in a conversation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let clientUserToken: string;
  let clientId: string;

  const as = (token: string) => ({
    post: (path: string) =>
      request(app.getHttpServer()).post(path).set(bearer(token)),
    get: (path: string) =>
      request(app.getHttpServer()).get(path).set(bearer(token)),
  });
  const admin = () => as(adminToken);

  /** Creates the conversation by pushing a DM, so it exists the way it does in production. */
  const startChat = async (senderId: string, accountId = 'page-pause') => {
    const before = n8nCalls().length;
    await pushDm(app, { accountId, senderId, text: 'first message' });
    await waitFor(
      async () => {
        await sweepDmBuffers(app);
        return n8nCalls().length;
      },
      (n) => n > before,
      20_000,
      300,
    );
    return prisma.chat.findFirstOrThrow({ where: { senderId } });
  };

  const settle = async () => {
    await waitFor(
      () =>
        app
          .get(PrismaService)
          .chat.count()
          .then(() => true),
      Boolean,
    );
    await sleep(1_500); // longer than the DM window
    await sweepDmBuffers(app);
  };

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushRedis(app);
    await createUser(prisma, 'admin@e2e.test', ['ADMIN']);
    clientId = (await createChatClient(app, { fbPageId: 'page-pause' })).id;
    await createClientUser(prisma, 'owner@e2e.test', clientId);
    adminToken = (await login(app, 'admin@e2e.test')).token;
    clientUserToken = (await login(app, 'owner@e2e.test')).token;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    stubN8n();
    stubGraph(() => ({ status: 200, body: { message_id: 'm-1' } }));
  });
  afterEach(() => {
    restoreGraph(); // in reverse order: graph wraps the n8n stub
    restoreN8n();
  });

  describe('access', () => {
    let chatId: string;
    beforeAll(async () => {
      stubN8n();
      chatId = (await startChat('cust-access')).id;
      restoreN8n();
    });

    it.each(['pause', 'resume'])(
      '%s answers 401 without a token',
      async (action) => {
        await request(app.getHttpServer())
          .post(`/chats/${chatId}/${action}`)
          .send(action === 'pause' ? { duration: '1h' } : {})
          .expect(401);
      },
    );

    it.each(['pause', 'resume'])(
      '%s answers 403 to a CLIENT-role user and changes nothing',
      async (action) => {
        await as(clientUserToken)
          .post(`/chats/${chatId}/${action}`)
          .send(action === 'pause' ? { duration: '1h' } : {})
          .expect(403);
        const chat = await prisma.chat.findUniqueOrThrow({
          where: { id: chatId },
        });
        expect(chat.pausedAt).toBeNull();
      },
    );

    it('answers 404 for an unknown conversation and 422 for a bad id or duration', async () => {
      await admin()
        .post('/chats/00000000-0000-4000-8000-000000000000/pause')
        .send({ duration: '1h' })
        .expect(404);
      await admin()
        .post('/chats/not-a-uuid/pause')
        .send({ duration: '1h' })
        .expect(422);
      await admin()
        .post(`/chats/${chatId}/pause`)
        .send({ duration: '2h' })
        .expect(422);
      await admin().post(`/chats/${chatId}/pause`).send({}).expect(422);
    });
  });

  it('pauses for an hour, records who did it, and lists the conversation as paused', async () => {
    const chat = await startChat('cust-pause');

    const res = await admin()
      .post(`/chats/${chat.id}/pause`)
      .send({ duration: '1h' })
      .expect(200);
    const body = res.body as ChatBody;

    expect(body.paused).toBe(true);
    expect(body.pausedBy?.name).toBe('admin');
    const hours =
      (new Date(body.pausedUntil!).getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(0.95);
    expect(hours).toBeLessThanOrEqual(1);

    const events = await prisma.chatPauseEvent.findMany({
      where: { chatId: chat.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'PAUSED',
      duration: '1h',
      actorName: 'admin',
    });

    const paused = await admin().get('/chats?paused=true').expect(200);
    expect(
      (paused.body as { data: { id: string }[] }).data.map((c) => c.id),
    ).toContain(chat.id);
    const active = await admin().get('/chats?paused=false').expect(200);
    expect(
      (active.body as { data: { id: string }[] }).data.map((c) => c.id),
    ).not.toContain(chat.id);
  });

  it('sends nothing while paused and stores each message as not answered (SC-003)', async () => {
    const chat = await startChat('cust-silent');
    await admin()
      .post(`/chats/${chat.id}/pause`)
      .send({ duration: '24h' })
      .expect(200);
    const callsBefore = n8nCalls().length;

    for (let i = 1; i <= 3; i++) {
      await pushDm(app, {
        accountId: 'page-pause',
        senderId: 'cust-silent',
        text: `while paused ${i}`,
      });
    }
    await waitFor(
      () =>
        prisma.messageReply.count({
          where: { chatId: chat.id, answered: false },
        }),
      (n) => n === 3,
    );
    await settle();

    expect(n8nCalls().length).toBe(callsBefore);
    const stored = await prisma.messageReply.findMany({
      where: { chatId: chat.id, answered: false },
      orderBy: { createdAt: 'asc' },
    });
    expect(stored.map((m) => m.reply)).toEqual(['', '', '']);
    expect(stored.map((m) => m.message).sort()).toEqual([
      'while paused 1',
      'while paused 2',
      'while paused 3',
    ]);
  });

  it('does not touch the other conversations of the same client (FR-015)', async () => {
    const paused = await startChat('cust-one');
    await admin()
      .post(`/chats/${paused.id}/pause`)
      .send({ duration: '24h' })
      .expect(200);
    const before = n8nCalls().length;

    await pushDm(app, {
      accountId: 'page-pause',
      senderId: 'cust-two',
      text: 'hello from another customer',
    });
    await waitFor(
      async () => {
        await sweepDmBuffers(app);
        return n8nCalls().length;
      },
      (n) => n === before + 1,
      20_000,
      300,
    );
  });

  it('answers only new messages after a resume, and records the resume (SC-004)', async () => {
    const chat = await startChat('cust-resume');
    await admin()
      .post(`/chats/${chat.id}/pause`)
      .send({ duration: 'until_resumed' })
      .expect(200);
    await pushDm(app, {
      accountId: 'page-pause',
      senderId: 'cust-resume',
      text: 'during the pause',
    });
    await waitFor(
      () =>
        prisma.messageReply.count({
          where: { chatId: chat.id, answered: false },
        }),
      (n) => n === 1,
    );

    const res = await admin().post(`/chats/${chat.id}/resume`).expect(200);
    expect((res.body as ChatBody).paused).toBe(false);
    const events = await prisma.chatPauseEvent.findMany({
      where: { chatId: chat.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.action)).toEqual(['PAUSED', 'RESUMED']);
    expect(events[1].actorName).toBe('admin');

    const before = n8nCalls().length;
    await pushDm(app, {
      accountId: 'page-pause',
      senderId: 'cust-resume',
      text: 'after the resume',
    });
    await waitFor(
      async () => {
        await sweepDmBuffers(app);
        return n8nCalls().length;
      },
      (n) => n === before + 1,
      20_000,
      300,
    );
    // the message from the pause was not answered afterwards
    expect(
      await prisma.messageReply.count({
        where: { chatId: chat.id, answered: false },
      }),
    ).toBe(1);
  });

  it('resuming a conversation that is not paused changes nothing', async () => {
    const chat = await startChat('cust-active');
    const res = await admin().post(`/chats/${chat.id}/resume`).expect(200);
    expect((res.body as ChatBody).paused).toBe(false);
    expect(
      await prisma.chatPauseEvent.count({ where: { chatId: chat.id } }),
    ).toBe(0);
  });

  it('ends a timed pause on time and records an automatic resume', async () => {
    const chat = await startChat('cust-timed');
    await admin()
      .post(`/chats/${chat.id}/pause`)
      .send({ duration: '1h' })
      .expect(200);

    // move the end into the past instead of waiting for it
    const end = new Date(Date.now() - 60_000);
    await prisma.chat.update({
      where: { id: chat.id },
      data: { pausedUntil: end },
    });

    // the state is computed on every read: it is already active again, before the sweeper runs
    const read = await admin().get(`/chats/${chat.id}`).expect(200);
    const body = read.body as ChatBody;
    expect(body.paused).toBe(false);
    expect(body.pausedUntil).toBeNull();
    expect(body.pausedBy).toBeNull();

    await app.get(ConversationsService).releaseExpiredPauses();

    const events = await prisma.chatPauseEvent.findMany({
      where: { chatId: chat.id, action: 'RESUMED' },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actorId).toBeNull(); // automatic
    expect(events[0].createdAt.getTime()).toBe(end.getTime()); // dated at the scheduled end
    const stored = await prisma.chat.findUniqueOrThrow({
      where: { id: chat.id },
    });
    expect(stored.pausedAt).toBeNull();

    // a second sweep records nothing more
    await app.get(ConversationsService).releaseExpiredPauses();
    expect(
      await prisma.chatPauseEvent.count({
        where: { chatId: chat.id, action: 'RESUMED' },
      }),
    ).toBe(1);
  });

  it('sends the reply of a conversation that is not paused and records it as answered', async () => {
    const chat = await startChat('cust-answered');
    const requestId = (
      n8nCalls()[n8nCalls().length - 1].body as { requestId: string }
    ).requestId;

    await request(app.getHttpServer())
      .post('/n8n/callback')
      .set('x-webhook-secret', process.env.N8N_WEBHOOK_SECRET as string)
      .send({ id: requestId, text: 'the reply of the workflow' })
      .expect(200);

    const rows = await waitFor(
      () =>
        prisma.messageReply.findMany({
          where: { chatId: chat.id, answered: true },
        }),
      (list) => list.length >= 1,
    );
    expect(rows[0].reply).toBe('the reply of the workflow');
    expect(
      graphCalls().filter((url) => url.pathname.endsWith('/messages')),
    ).toHaveLength(1);
  });

  it('does not send a reply that arrives after the conversation was paused', async () => {
    const chat = await startChat('cust-callback');
    const requestId = (
      n8nCalls()[n8nCalls().length - 1].body as { requestId: string }
    ).requestId;
    await admin()
      .post(`/chats/${chat.id}/pause`)
      .send({ duration: '1h' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/n8n/callback')
      .set('x-webhook-secret', process.env.N8N_WEBHOOK_SECRET as string)
      .send({ id: requestId, text: 'a late reply from the workflow' })
      .expect(200);
    expect(res.body).toEqual({ acknowledged: true });

    // the sender is fire-and-forget: wait for the unanswered record
    await waitFor(
      () =>
        prisma.messageReply.count({
          where: { chatId: chat.id, answered: false },
        }),
      (n) => n >= 1,
    );
    expect(
      graphCalls().filter((url) => url.pathname.endsWith('/messages')),
    ).toHaveLength(0);
    expect(
      await prisma.messageReply.count({
        where: { chatId: chat.id, answered: true },
      }),
    ).toBe(0);
  });
});
