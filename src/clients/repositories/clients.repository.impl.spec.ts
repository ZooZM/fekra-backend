import { Logger } from '@nestjs/common';
import { ClientsRepository } from './clients.repository.impl';

const row = {
  id: 'c1',
  name: 'Acme',
  fbPageId: 'page-1',
  instaAccountId: null,
  chatSubscribed: true,
  chatWorkflowEndpoint: 'chat-acme',
};

describe('ClientsRepository chat reads (feature 003)', () => {
  let prisma: {
    client: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let redis: { get: jest.Mock; set: jest.Mock };
  let repo: ClientsRepository;

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    prisma = {
      client: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    redis = { get: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
    repo = new ClientsRepository(prisma as never, redis as never);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('findChatRoute', () => {
    it('reads the database first and refreshes the cache for 30 minutes', async () => {
      prisma.client.findFirst.mockResolvedValue(row);
      redis.get.mockResolvedValue(
        JSON.stringify({ ...row, chatSubscribed: false }),
      );

      const route = await repo.findChatRoute('page-1');

      // the stale cached copy is ignored while the database answers
      expect(route).toEqual({
        clientId: 'c1',
        name: 'Acme',
        chatSubscribed: true,
        chatWorkflowEndpoint: 'chat-acme',
      });
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).toHaveBeenCalledWith(
        'client:account:page-1',
        JSON.stringify(row),
        'EX',
        1800,
      );
    });

    it('returns null for an unknown account and caches nothing', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(repo.findChatRoute('nope')).resolves.toBeNull();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('returns null without querying for an empty account id', async () => {
      await expect(repo.findChatRoute('')).resolves.toBeNull();
      expect(prisma.client.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to the cached copy when the database fails', async () => {
      prisma.client.findFirst.mockRejectedValue(new Error('db down'));
      redis.get.mockResolvedValue(JSON.stringify(row));

      const route = await repo.findChatRoute('page-1');

      expect(route?.chatWorkflowEndpoint).toBe('chat-acme');
      expect(redis.get).toHaveBeenCalledWith('client:account:page-1');
    });

    it('returns null and logs an error when the database fails and nothing is cached', async () => {
      prisma.client.findFirst.mockRejectedValue(new Error('db down'));
      redis.get.mockResolvedValue(null);

      await expect(repo.findChatRoute('page-1')).resolves.toBeNull();
      expect(Logger.prototype.error).toHaveBeenCalled();
    });

    it('still answers when the cache cannot be written', async () => {
      prisma.client.findFirst.mockResolvedValue(row);
      redis.set.mockRejectedValue(new Error('redis down'));
      await expect(repo.findChatRoute('page-1')).resolves.toMatchObject({
        clientId: 'c1',
      });
    });
  });

  describe('findChatRouteById', () => {
    it('reads the database every time and never touches the cache', async () => {
      prisma.client.findUnique.mockResolvedValue(row);

      await expect(repo.findChatRouteById('c1')).resolves.toMatchObject({
        chatSubscribed: true,
      });
      expect(redis.get).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('lets a database error through so the delivery can retry later', async () => {
      prisma.client.findUnique.mockRejectedValue(new Error('db down'));
      await expect(repo.findChatRouteById('c1')).rejects.toThrow('db down');
    });

    it('returns null for an unknown client', async () => {
      prisma.client.findUnique.mockResolvedValue(null);
      await expect(repo.findChatRouteById('c9')).resolves.toBeNull();
    });
  });

  describe('findWorkflowDataFresh', () => {
    const workflowRow = {
      ...row,
      aiConfig: { language: 'ARABIC' },
      dmReplyConfig: {},
      commentReplyConfig: {},
      services: [{ id: 's1', name: 'Cut', variants: null }],
      offers: [],
      businessInfo: null,
    };

    it('includes services, offers and business info and refreshes the cache', async () => {
      prisma.client.findFirst.mockResolvedValue(workflowRow);

      const data = await repo.findWorkflowDataFresh('page-1');

      expect(prisma.client.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          include: { services: true, offers: true, businessInfo: true },
        }),
      );
      expect(data?.services).toHaveLength(1);
      expect(redis.set).toHaveBeenCalledWith(
        'client:workflow:page-1',
        expect.any(String),
        'EX',
        1800,
      );
    });

    it('falls back to the cached copy when the database fails', async () => {
      prisma.client.findFirst.mockRejectedValue(new Error('db down'));
      redis.get.mockResolvedValue(JSON.stringify(workflowRow));
      const data = await repo.findWorkflowDataFresh('page-1');
      expect(data?.id).toBe('c1');
      expect(redis.get).toHaveBeenCalledWith('client:workflow:page-1');
    });

    it('returns null when the database fails and nothing is cached', async () => {
      prisma.client.findFirst.mockRejectedValue(new Error('db down'));
      redis.get.mockResolvedValue(null);
      await expect(repo.findWorkflowDataFresh('page-1')).resolves.toBeNull();
    });
  });

  describe('findChatEndpointConflict', () => {
    it('is true when another client has the endpoint', async () => {
      prisma.client.findFirst.mockResolvedValue({ id: 'c2' });
      await expect(
        repo.findChatEndpointConflict('chat-acme', 'c1'),
      ).resolves.toBe(true);
      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: { chatWorkflowEndpoint: 'chat-acme', id: { not: 'c1' } },
        select: { id: true },
      });
    });

    it('is false when nobody else has it, and does not exclude anyone on create', async () => {
      prisma.client.findFirst.mockResolvedValue(null);
      await expect(repo.findChatEndpointConflict('free')).resolves.toBe(false);
      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: { chatWorkflowEndpoint: 'free' },
        select: { id: true },
      });
    });
  });

  describe('findAll chatSubscribed filter', () => {
    it('adds the filter to the page and to the total', async () => {
      await repo.findAll({
        page: 1,
        limit: 20,
        orderBy: 'createdAt',
        orderDir: 'desc',
        chatSubscribed: false,
      } as never);

      const where = { chatSubscribed: false };
      expect(prisma.client.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where }),
      );
      expect(prisma.client.count).toHaveBeenCalledWith({ where });
    });

    it('does not filter by subscription when the parameter is absent', async () => {
      await repo.findAll({
        page: 1,
        limit: 20,
        orderBy: 'createdAt',
        orderDir: 'desc',
      } as never);
      expect(prisma.client.count).toHaveBeenCalledWith({ where: {} });
    });
  });
});
