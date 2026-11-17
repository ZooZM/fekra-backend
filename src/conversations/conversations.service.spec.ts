import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '@app/users/types/safe-user.type';
import { ConversationsService } from './conversations.service';

const NOW = new Date('2026-11-14T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const admin = {
  id: 'admin-1',
  name: 'Admin One',
  roles: [UserRole.ADMIN],
  clientId: null,
} as SafeUser;
const clientUser = {
  id: 'user-1',
  name: 'Owner',
  roles: [UserRole.CLIENT],
  clientId: 'client-1',
} as SafeUser;

const chatRow = (over: Record<string, unknown> = {}) => ({
  id: 'chat-1',
  clientId: 'client-1',
  platform: 'FACEBOOK',
  senderId: 'customer-1',
  receiverId: 'page-1',
  pausedAt: null,
  pausedUntil: null,
  pausedById: null,
  pausedByName: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-13T00:00:00.000Z'),
  client: { id: 'client-1', name: 'Acme' },
  ...over,
});

describe('ConversationsService', () => {
  let service: ConversationsService;
  let repo: Record<string, jest.Mock>;

  beforeEach(() => {
    repo = Object.fromEntries(
      [
        'findAll',
        'findById',
        'lastExchanges',
        'findMessages',
        'findOrCreate',
        'createMessage',
        'createUnansweredMessage',
        'pause',
        'resume',
        'releaseExpiredPauses',
        'findRecentExchanges',
        'findLastMessagesByIdForWorkflow',
      ].map((method) => [method, jest.fn()]),
    );
    repo.lastExchanges.mockResolvedValue(new Map());
    service = new ConversationsService(repo as never);
  });

  describe('listing and reading', () => {
    it('forces CLIENT users to their assigned client when listing chats', async () => {
      const query = {
        page: 1,
        limit: 20,
        orderBy: 'updatedAt',
        orderDir: 'desc',
        clientId: 'client-2',
      } as const;
      repo.findAll.mockResolvedValue({ data: [], meta: {} });

      await service.findAll(query, clientUser);

      expect(repo.findAll).toHaveBeenCalledWith(query, 'client-1');
    });

    it('passes the requested clientId through for an ADMIN', async () => {
      const query = { page: 1, limit: 20, clientId: 'client-2' } as never;
      repo.findAll.mockResolvedValue({ data: [], meta: {} });

      await service.findAll(query, admin);

      expect(repo.findAll).toHaveBeenCalledWith(query, 'client-2');
    });

    it('refuses a CLIENT-role user with no assigned client', async () => {
      const orphan = { ...clientUser, clientId: null } as SafeUser;
      await expect(service.findAll({} as never, orphan)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('maps each chat with its client name and last exchange, one query per page', async () => {
      const last = {
        message: 'hi',
        reply: 'hello',
        answered: true,
        createdAt: NOW,
      };
      repo.findAll.mockResolvedValue({
        data: [chatRow(), chatRow({ id: 'chat-2' })],
        meta: { total: 2 },
      });
      repo.lastExchanges.mockResolvedValue(new Map([['chat-1', last]]));

      const page = await service.findAll({} as never, admin);

      expect(repo.lastExchanges).toHaveBeenCalledTimes(1);
      expect(repo.lastExchanges).toHaveBeenCalledWith(['chat-1', 'chat-2']);
      expect(page.data[0]).toMatchObject({
        id: 'chat-1',
        clientName: 'Acme',
        lastExchange: last,
      });
      expect(page.data[1].lastExchange).toBeNull();
      expect(page.meta).toEqual({ total: 2 });
    });

    it('returns one mapped conversation', async () => {
      repo.findById.mockResolvedValue(chatRow());
      const record = await service.findOne('chat-1', clientUser);
      expect(repo.findById).toHaveBeenCalledWith('chat-1', 'client-1');
      expect(record).toMatchObject({ id: 'chat-1', paused: false });
    });

    it('answers not found for a missing chat or one outside the client scope', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.findOne('chat-9', clientUser),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('does not return messages from a conversation outside the client scope', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.findMessages(
          'f83d1a96-b637-49a7-b66a-4db47ae12345',
          { page: 1, limit: 20, orderBy: 'createdAt', orderDir: 'desc' },
          clientUser,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.findMessages).not.toHaveBeenCalled();
    });

    it('hides who paused a conversation from a CLIENT-role reader', async () => {
      repo.findById.mockResolvedValue(
        chatRow({
          pausedAt: new Date(Date.now() - HOUR),
          pausedUntil: null,
          pausedById: 'admin-1',
          pausedByName: 'Admin One',
        }),
      );
      const asClient = await service.findOne('chat-1', clientUser);
      const asAdmin = await service.findOne('chat-1', admin);
      expect(asClient.paused).toBe(true);
      expect(asClient.pausedBy).toBeNull();
      expect(asAdmin.pausedBy).toEqual({ id: 'admin-1', name: 'Admin One' });
    });
  });

  describe('pause', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW);
      repo.findById.mockResolvedValue(chatRow());
      repo.pause.mockImplementation((_id, until: Date | null) =>
        Promise.resolve(
          chatRow({
            pausedAt: NOW,
            pausedUntil: until,
            pausedById: 'admin-1',
            pausedByName: 'Admin One',
          }),
        ),
      );
    });

    it('forwards workflow message history lookup to the repository', async () => {
      const messages = [{ id: 'message-1' }] as never;
      repo.findLastMessagesByIdForWorkflow.mockResolvedValue(messages);

      await expect(
        service.findLastMessagesByIdForWorkflow(
          'customer-1',
          'page-1',
          'facebook',
        ),
      ).resolves.toBe(messages);
      expect(repo.findLastMessagesByIdForWorkflow).toHaveBeenCalledWith(
        'customer-1',
        'page-1',
        'facebook',
      );
    });
    afterEach(() => jest.useRealTimers());

    it.each([
      ['until_resumed', null],
      ['1h', new Date(NOW.getTime() + HOUR)],
      ['24h', new Date(NOW.getTime() + 24 * HOUR)],
      ['7d', new Date(NOW.getTime() + 7 * 24 * HOUR)],
    ] as const)('computes the end of a "%s" pause', async (duration, until) => {
      const record = await service.pause('chat-1', { duration }, admin);

      expect(repo.pause).toHaveBeenCalledWith('chat-1', until, duration, {
        id: 'admin-1',
        name: 'Admin One',
      });
      expect(record.paused).toBe(true);
      expect(record.pausedUntil).toEqual(until);
    });

    it('lets an admin pause a conversation that is already paused (new duration replaces it)', async () => {
      repo.findById.mockResolvedValue(
        chatRow({ pausedAt: NOW, pausedUntil: null }),
      );
      await service.pause('chat-1', { duration: '1h' }, admin);
      expect(repo.pause).toHaveBeenCalledTimes(1);
    });

    it('answers not found for a missing chat and does not write', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.pause('chat-9', { duration: '1h' }, admin),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.pause).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(NOW);
    });
    afterEach(() => jest.useRealTimers());

    it('resumes a paused conversation with the acting admin', async () => {
      repo.findById.mockResolvedValue(
        chatRow({ pausedAt: new Date(NOW.getTime() - HOUR) }),
      );
      repo.resume.mockResolvedValue(chatRow());

      const record = await service.resume('chat-1', admin);

      expect(repo.resume).toHaveBeenCalledWith('chat-1', {
        id: 'admin-1',
        name: 'Admin One',
      });
      expect(record.paused).toBe(false);
    });

    it('changes nothing on an active conversation', async () => {
      repo.findById.mockResolvedValue(chatRow());
      const record = await service.resume('chat-1', admin);
      expect(repo.resume).not.toHaveBeenCalled();
      expect(record.paused).toBe(false);
    });

    it('changes nothing when a timed pause has already ended', async () => {
      repo.findById.mockResolvedValue(
        chatRow({
          pausedAt: new Date(NOW.getTime() - 2 * HOUR),
          pausedUntil: new Date(NOW.getTime() - HOUR),
        }),
      );
      await service.resume('chat-1', admin);
      expect(repo.resume).not.toHaveBeenCalled();
    });
  });

  describe('internal writes', () => {
    it('validates and normalizes internal chat writes', async () => {
      const input = {
        clientId: 'ac8f7ab8-399f-4ae4-84e8-0ee2f4bef3a2',
        platform: 'instagram',
        senderId: 'customer-1',
        receiverId: 'account-1',
      };
      repo.findOrCreate.mockResolvedValue({});

      await service.findOrCreate(input);

      expect(repo.findOrCreate).toHaveBeenCalledWith({
        ...input,
        platform: 'INSTAGRAM',
      });
    });

    it('stores an unanswered message after validating it', async () => {
      const chatId = 'ac8f7ab8-399f-4ae4-84e8-0ee2f4bef3a2';
      repo.createUnansweredMessage.mockResolvedValue({});

      await service.createUnansweredMessage({ chatId, message: '  hi \u0000' });

      expect(repo.createUnansweredMessage).toHaveBeenCalledWith({
        chatId,
        message: 'hi',
      });
      // validation throws synchronously, like createMessage
      expect(() =>
        service.createUnansweredMessage({ chatId, message: '   ' }),
      ).toThrow();
    });

    it('tells whether a chat is paused now', () => {
      expect(service.isPaused({ pausedAt: null, pausedUntil: null })).toBe(
        false,
      );
      expect(
        service.isPaused({ pausedAt: new Date(), pausedUntil: null }),
      ).toBe(true);
    });

    it('deletes by retention through the repository and returns its counts', async () => {
      const cutoff = new Date('2025-11-14T12:00:00.000Z');
      repo.purgeBefore = jest
        .fn()
        .mockResolvedValue({ chats: 2, exchanges: 9 });

      await expect(service.purgeBefore(cutoff)).resolves.toEqual({
        chats: 2,
        exchanges: 9,
      });
      expect(repo.purgeBefore).toHaveBeenCalledWith(cutoff);
    });

    it('releases expired pauses using the current time', async () => {
      jest.useFakeTimers().setSystemTime(NOW);
      repo.releaseExpiredPauses.mockResolvedValue(3);
      await expect(service.releaseExpiredPauses()).resolves.toBe(3);
      expect(repo.releaseExpiredPauses).toHaveBeenCalledWith(NOW);
      jest.useRealTimers();
    });
  });

  describe('recentExchanges (feature 004)', () => {
    it('delegates to the repository with the client scope', async () => {
      const rows = [
        { message: 'hi', reply: 'hello', answered: true, createdAt: NOW },
      ];
      repo.findRecentExchanges.mockResolvedValue(rows);
      const query = {
        clientId: 'client-1',
        platform: 'INSTAGRAM' as const,
        receiverId: 'ig-1',
        senderId: 'customer-1',
        limit: 10,
      };

      await expect(service.recentExchanges(query)).resolves.toBe(rows);
      expect(repo.findRecentExchanges).toHaveBeenCalledWith(query);
    });
  });
});
