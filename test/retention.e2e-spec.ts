import { INestApplication } from '@nestjs/common';
import { RetentionService } from '../src/retention/retention.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApp, resetDb } from './utils/e2e-app';
import { createChatClient, flushRedis } from './utils/chat-e2e';

const monthsAgo = (months: number) => {
  const date = new Date();
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
};

describe('Data retention (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let clientId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    await resetDb(prisma);
    await flushRedis(app);
    clientId = (await createChatClient(app, { fbPageId: 'page-r' })).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const chat = (senderId: string, updatedAt: Date) =>
    prisma.chat.create({
      data: {
        clientId,
        platform: 'FACEBOOK',
        senderId,
        receiverId: 'page-r',
        createdAt: updatedAt,
        updatedAt,
      },
    });

  it('deletes what is older than the period and keeps the rest (SC-021)', async () => {
    // a conversation with no activity for 13 months: it goes, with its exchanges and pause events
    const idle = await chat('idle', monthsAgo(13));
    await prisma.messageReply.create({
      data: {
        chatId: idle.id,
        message: 'old',
        reply: 'old',
        createdAt: monthsAgo(13),
      },
    });
    await prisma.chatPauseEvent.create({
      data: { chatId: idle.id, action: 'PAUSED', createdAt: monthsAgo(13) },
    });

    // an active conversation: only its exchange from 13 months ago goes
    const active = await chat('active', new Date());
    await prisma.messageReply.createMany({
      data: [
        {
          chatId: active.id,
          message: 'ancient',
          reply: 'a',
          createdAt: monthsAgo(13),
        },
        {
          chatId: active.id,
          message: 'recent',
          reply: 'b',
          createdAt: monthsAgo(11),
        },
      ],
    });

    // comments: counted from when they were first classified
    const comment = (commentId: string, createdAt: Date) => ({
      clientId,
      platform: 'FACEBOOK' as const,
      commentId,
      comment: commentId,
      classification: 'INQUIRY' as const,
      reason: 'test',
      createdAt,
    });
    await prisma.commentReply.createMany({
      data: [
        comment('old-comment', monthsAgo(13)),
        comment('new-comment', monthsAgo(11)),
      ],
    });

    // a download record holds no customer text, so it is not deleted
    await prisma.commentExportRecord.create({
      data: {
        actorId: '00000000-0000-4000-8000-000000000001',
        actorName: 'Admin',
        actorEmail: 'admin@e2e.test',
        filters: { snapshotAt: monthsAgo(13).toISOString() },
        completed: true,
        rowCount: 1,
        createdAt: monthsAgo(13),
      },
    });

    // leads (phone numbers, feature 004): counted from their last update
    const lead = (senderId: string, updatedAt: Date) => ({
      clientId,
      platform: 'FACEBOOK' as const,
      accountId: 'page-r',
      senderId,
      phone: '01012345678',
      createdAt: updatedAt,
      updatedAt,
    });
    await prisma.lead.createMany({
      data: [lead('old-lead', monthsAgo(13)), lead('new-lead', monthsAgo(11))],
    });

    await app.get(RetentionService).runOnce();

    expect(await prisma.chat.findUnique({ where: { id: idle.id } })).toBeNull();
    expect(
      await prisma.messageReply.count({ where: { chatId: idle.id } }),
    ).toBe(0);
    expect(
      await prisma.chatPauseEvent.count({ where: { chatId: idle.id } }),
    ).toBe(0);

    expect(
      await prisma.chat.findUnique({ where: { id: active.id } }),
    ).not.toBeNull();
    const kept = await prisma.messageReply.findMany({
      where: { chatId: active.id },
    });
    expect(kept.map((m) => m.message)).toEqual(['recent']);

    const comments = await prisma.commentReply.findMany({
      select: { commentId: true },
    });
    expect(comments.map((c) => c.commentId)).toEqual(['new-comment']);

    expect(await prisma.commentExportRecord.count()).toBe(1);

    const leads = await prisma.lead.findMany({ select: { senderId: true } });
    expect(leads.map((l) => l.senderId)).toEqual(['new-lead']);
  });

  it('does nothing the second time, and keeps what is inside the period', async () => {
    const before = {
      chats: await prisma.chat.count(),
      exchanges: await prisma.messageReply.count(),
      comments: await prisma.commentReply.count(),
      leads: await prisma.lead.count(),
    };

    await app.get(RetentionService).runOnce();

    expect({
      chats: await prisma.chat.count(),
      exchanges: await prisma.messageReply.count(),
      comments: await prisma.commentReply.count(),
      leads: await prisma.lead.count(),
    }).toEqual(before);
  });

  it('counts a re-classified comment from its first classification', async () => {
    await prisma.commentReply.create({
      data: {
        clientId,
        platform: 'FACEBOOK',
        commentId: 'reclassified',
        comment: 'x',
        classification: 'SPAM',
        reason: 'test',
        createdAt: monthsAgo(13),
      },
    });
    // a later re-classification updates the row but not its first classification time
    await prisma.commentReply.update({
      where: {
        platform_commentId: { platform: 'FACEBOOK', commentId: 'reclassified' },
      },
      data: { classification: 'INQUIRY' },
    });

    await app.get(RetentionService).runOnce();

    expect(
      await prisma.commentReply.count({ where: { commentId: 'reclassified' } }),
    ).toBe(0);
  });
});
