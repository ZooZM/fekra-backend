import { ConversationsRepository } from './conversations.repository.impl';

const NOW = new Date('2026-11-14T12:00:00.000Z');
const actor = { id: 'admin-1', name: 'Admin One' };

describe('ConversationsRepository (feature 003)', () => {
  let tx: {
    chat: { update: jest.Mock };
    chatPauseEvent: { create: jest.Mock; createMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    chat: { findMany: jest.Mock; count: jest.Mock; findFirst: jest.Mock };
    messageReply: { create: jest.Mock; findMany: jest.Mock };
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    $transaction: jest.Mock;
  };
  let repo: ConversationsRepository;

  const query = (over: Record<string, unknown> = {}) =>
    ({
      page: 1,
      limit: 20,
      orderBy: 'updatedAt',
      orderDir: 'desc',
      ...over,
    }) as never;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    tx = {
      chat: { update: jest.fn().mockResolvedValue({ id: 'chat-1' }) },
      chatPauseEvent: {
        create: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $queryRaw: jest.fn(),
    };
    prisma = {
      chat: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
      },
      messageReply: {
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (t: unknown) => unknown)(tx)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    repo = new ConversationsRepository(prisma as never);
  });
  afterEach(() => jest.useRealTimers());

  describe('findAll', () => {
    it('includes the client name and ends the order with the id', async () => {
      await repo.findAll(query());
      expect(prisma.chat.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { client: { select: { id: true, name: true } } },
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: 0,
          take: 20,
        }),
      );
    });

    it('filters by client, platform and the exact customer identifier', async () => {
      await repo.findAll(
        query({ platform: 'FACEBOOK', senderId: 'psid-1' }),
        'client-1',
      );
      const where = {
        clientId: 'client-1',
        platform: 'FACEBOOK',
        senderId: 'psid-1',
      };
      expect(prisma.chat.count).toHaveBeenCalledWith({ where });
    });

    it('paused=true keeps only conversations that are paused now', async () => {
      await repo.findAll(query({ paused: true }));
      expect(prisma.chat.count).toHaveBeenCalledWith({
        where: {
          pausedAt: { not: null },
          OR: [{ pausedUntil: null }, { pausedUntil: { gt: NOW } }],
        },
      });
    });

    it('paused=false is the exact opposite, for the page and the total', async () => {
      await repo.findAll(query({ paused: false }));
      const pausedNow = {
        pausedAt: { not: null },
        OR: [{ pausedUntil: null }, { pausedUntil: { gt: NOW } }],
      };
      expect(prisma.chat.count).toHaveBeenCalledWith({
        where: { NOT: pausedNow },
      });
      expect(prisma.chat.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { NOT: pausedNow } }),
      );
    });

    it('does not filter by pause state when the parameter is absent', async () => {
      await repo.findAll(query());
      expect(prisma.chat.count).toHaveBeenCalledWith({ where: {} });
    });
  });

  describe('findById', () => {
    it('scopes to the client when one is given', async () => {
      await repo.findById('chat-1', 'client-1');
      expect(prisma.chat.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'chat-1', clientId: 'client-1' },
        }),
      );
    });

    it('does not scope for an admin', async () => {
      await repo.findById('chat-1');
      expect(prisma.chat.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'chat-1' } }),
      );
    });
  });

  describe('lastExchanges', () => {
    it('makes no query for an empty page', async () => {
      await expect(repo.lastExchanges([])).resolves.toEqual(new Map());
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('maps the rows of one query by chat id', async () => {
      prisma.$queryRaw.mockResolvedValue([
        {
          chat_id: 'chat-1',
          message: 'hi',
          reply: '',
          answered: false,
          created_at: NOW,
        },
        {
          chat_id: 'chat-2',
          message: 'a',
          reply: 'b',
          answered: true,
          created_at: NOW,
        },
      ]);

      const result = await repo.lastExchanges(['chat-1', 'chat-2', 'chat-3']);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result.get('chat-1')).toEqual({
        message: 'hi',
        reply: '',
        answered: false,
        createdAt: NOW,
      });
      expect(result.get('chat-2')?.answered).toBe(true);
      expect(result.has('chat-3')).toBe(false);
    });

    it('asks for the newest exchange per chat, cut to 200 characters', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      await repo.lastExchanges(['chat-1']);
      const sql = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toContain('DISTINCT ON (chat_id)');
      expect(sql).toContain('left(message, 200)');
      expect(sql).toContain('left(reply, 200)');
      expect(sql).toContain('ORDER BY chat_id, created_at DESC');
    });
  });

  describe('unanswered messages', () => {
    it('are stored with an empty reply and answered = false', async () => {
      await repo.createUnansweredMessage({ chatId: 'chat-1', message: 'hi' });
      expect(prisma.messageReply.create).toHaveBeenCalledWith({
        data: { chatId: 'chat-1', message: 'hi', reply: '', answered: false },
      });
    });
  });

  describe('pause and resume', () => {
    it('pause sets the four columns and records a PAUSED event in one transaction', async () => {
      const until = new Date(NOW.getTime() + 3_600_000);

      await repo.pause('chat-1', until, '1h', actor);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.chat.update).toHaveBeenCalledWith({
        where: { id: 'chat-1' },
        data: {
          pausedAt: NOW,
          pausedUntil: until,
          pausedById: 'admin-1',
          pausedByName: 'Admin One',
        },
        include: { client: { select: { id: true, name: true } } },
      });
      expect(tx.chatPauseEvent.create).toHaveBeenCalledWith({
        data: {
          chatId: 'chat-1',
          action: 'PAUSED',
          duration: '1h',
          until,
          actorId: 'admin-1',
          actorName: 'Admin One',
        },
      });
    });

    it('pause until resumed stores a null end', async () => {
      await repo.pause('chat-1', null, 'until_resumed', actor);
      expect(
        (tx.chat.update.mock.calls[0] as [{ data: { pausedUntil: null } }])[0]
          .data.pausedUntil,
      ).toBeNull();
    });

    it('resume clears the columns and records a RESUMED event by the admin', async () => {
      await repo.resume('chat-1', actor);

      expect(tx.chat.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            pausedAt: null,
            pausedUntil: null,
            pausedById: null,
            pausedByName: null,
          },
        }),
      );
      expect(tx.chatPauseEvent.create).toHaveBeenCalledWith({
        data: {
          chatId: 'chat-1',
          action: 'RESUMED',
          actorId: 'admin-1',
          actorName: 'Admin One',
        },
      });
    });
  });

  describe('releaseExpiredPauses', () => {
    it('claims the expired pauses once and records an automatic RESUMED for each', async () => {
      const end1 = new Date('2026-11-14T11:00:00.000Z');
      const end2 = new Date('2026-11-14T11:30:00.000Z');
      tx.$queryRaw.mockResolvedValue([
        { id: 'chat-1', paused_until: end1 },
        { id: 'chat-2', paused_until: end2 },
      ]);

      const released = await repo.releaseExpiredPauses(NOW);

      const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toContain('UPDATE chats');
      // RETURNING shows the row after the update, where paused_until is NULL: the end of the pause
      // has to come from the rows read (and locked) before it
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain('RETURNING c.id, due.paused_until');
      expect(tx.$queryRaw.mock.calls[0][1]).toBe(NOW);
      expect(tx.chatPauseEvent.createMany).toHaveBeenCalledWith({
        data: [
          // no actor: the pause ended by itself, dated at its scheduled end
          { chatId: 'chat-1', action: 'RESUMED', createdAt: end1 },
          { chatId: 'chat-2', action: 'RESUMED', createdAt: end2 },
        ],
      });
      expect(released).toBe(2);
    });

    it('writes nothing when no pause has ended', async () => {
      tx.$queryRaw.mockResolvedValue([]);
      await expect(repo.releaseExpiredPauses(NOW)).resolves.toBe(0);
      expect(tx.chatPauseEvent.createMany).not.toHaveBeenCalled();
    });
  });

  describe('purgeBefore (retention)', () => {
    const cutoff = new Date('2025-11-14T12:00:00.000Z');

    it('deletes conversations and then exchanges, in batches, until a batch comes back short', async () => {
      prisma.$executeRaw
        .mockResolvedValueOnce(3) // chats: 3 < batch of 3? no, equals -> go on
        .mockResolvedValueOnce(1) // chats: short batch, stop
        .mockResolvedValueOnce(3) // exchanges
        .mockResolvedValueOnce(2); // exchanges: short batch, stop

      const result = await repo.purgeBefore(cutoff, 3);

      expect(result).toEqual({ chats: 4, exchanges: 5 });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(4);
      const sql = (i: number) =>
        (prisma.$executeRaw.mock.calls[i][0] as string[]).join('?');
      expect(sql(0)).toContain('DELETE FROM chats');
      expect(sql(0)).toContain('updated_at <');
      expect(sql(2)).toContain('DELETE FROM message_replies');
      expect(sql(2)).toContain('created_at <');
      expect(prisma.$executeRaw.mock.calls[0][1]).toBe(cutoff);
      expect(prisma.$executeRaw.mock.calls[0][2]).toBe(3);
    });

    it('does one pass per table when nothing is old enough', async () => {
      prisma.$executeRaw.mockResolvedValue(0);
      await expect(repo.purgeBefore(cutoff)).resolves.toEqual({
        chats: 0,
        exchanges: 0,
      });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    });

    it('uses batches of 5,000 rows by default', async () => {
      prisma.$executeRaw.mockResolvedValue(0);
      await repo.purgeBefore(cutoff);
      expect(prisma.$executeRaw.mock.calls[0][2]).toBe(5000);
    });
  });

  describe('findRecentExchanges (feature 004)', () => {
    const recent = {
      clientId: 'client-1',
      platform: 'FACEBOOK' as const,
      receiverId: 'page-1',
      senderId: 'customer-1',
      limit: 3,
    };

    it('reads the newest rows of the conversation of that client, oldest first', async () => {
      const at = (m: number) => new Date(NOW.getTime() - m * 60_000);
      prisma.messageReply.findMany.mockResolvedValue([
        { message: 'c', reply: '', answered: false, createdAt: at(1) },
        { message: 'b', reply: 'B', answered: true, createdAt: at(2) },
        { message: 'a', reply: 'A', answered: true, createdAt: at(3) },
      ]);

      const rows = await repo.findRecentExchanges(recent);

      expect(rows.map((r) => r.message)).toEqual(['a', 'b', 'c']);
      expect(prisma.messageReply.findMany).toHaveBeenCalledWith({
        where: {
          chat: {
            clientId: 'client-1',
            platform: 'FACEBOOK',
            receiverId: 'page-1',
            senderId: 'customer-1',
          },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
        select: { message: true, reply: true, answered: true, createdAt: true },
      });
    });

    it('returns [] when there is no conversation, and creates nothing', async () => {
      await expect(repo.findRecentExchanges(recent)).resolves.toEqual([]);
      expect(prisma.messageReply.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
