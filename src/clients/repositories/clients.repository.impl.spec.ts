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

describe('ClientsRepository token flags (Instagram token)', () => {
  const stored = {
    ...row,
    businessCategory: 'Cafe',
    accessToken: 'v1:PAGE-CIPHERTEXT',
    instaAccessToken: null,
    aiConfig: { language: 'ARABIC' },
    dmReplyConfig: {},
    commentReplyConfig: {},
    version: 1,
  };
  const actor = { id: 'a1', name: 'Admin', email: 'admin@example.com' };
  const WITH_TOKENS = { accessToken: false, instaAccessToken: false };

  let tx: {
    client: Record<string, jest.Mock>;
    clientActivity: Record<string, jest.Mock>;
  };
  let prisma: {
    client: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let redis: { get: jest.Mock; set: jest.Mock };
  let repo: ClientsRepository;

  /** Every record the admin endpoints return: flags yes, token values no. */
  const expectFlagsOnly = (record: unknown) => {
    expect(record).toMatchObject({
      hasAccessToken: true,
      hasInstaAccessToken: false,
    });
    expect(JSON.stringify(record)).not.toContain('CIPHERTEXT');
  };

  beforeEach(() => {
    tx = {
      client: {
        create: jest.fn().mockResolvedValue(stored),
        findUnique: jest.fn().mockResolvedValue(stored),
        update: jest.fn().mockResolvedValue({ ...stored, name: 'New' }),
      },
      clientActivity: { create: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      client: {
        findFirst: jest.fn().mockResolvedValue(row),
        findUnique: jest.fn().mockResolvedValue(stored),
        findMany: jest.fn().mockResolvedValue([stored]),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (t: typeof tx) => Promise<unknown>)(tx)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    redis = { get: jest.fn(), set: jest.fn().mockResolvedValue('OK') };
    repo = new ClientsRepository(prisma as never, redis as never);
  });

  it('findAll reads the tokens only to report which are set', async () => {
    const page = await repo.findAll({
      page: 1,
      limit: 20,
      orderBy: 'createdAt',
      orderDir: 'desc',
    } as never);
    expect(prisma.client.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ omit: WITH_TOKENS }),
    );
    expectFlagsOnly(page.data[0]);
  });

  it('findById reads the tokens only to report which are set', async () => {
    const record = await repo.findById('c1');
    expect(prisma.client.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      omit: WITH_TOKENS,
    });
    expectFlagsOnly(record);
  });

  it('create returns the flags, not the tokens it stored', async () => {
    const record = await repo.create({ id: 'c1' } as never, actor);
    expect(tx.client.create).toHaveBeenCalledWith(
      expect.objectContaining({ omit: WITH_TOKENS }),
    );
    expectFlagsOnly(record);
  });

  it('update returns the flags, whether it saved or found nothing to change', async () => {
    const updated = await repo.update('c1', { name: 'New' }, 1, actor);
    expect(tx.client.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ omit: WITH_TOKENS }),
    );
    expect(tx.client.update).toHaveBeenCalledWith(
      expect.objectContaining({ omit: WITH_TOKENS }),
    );
    expect(updated?.status).toBe('updated');
    expectFlagsOnly((updated as { record: unknown }).record);

    const unchanged = await repo.update('c1', { name: 'Acme' }, 1, actor);
    expect(unchanged?.status).toBe('unchanged');
    expectFlagsOnly((unchanged as { record: unknown }).record);
  });

  it('never reads the tokens for the cached webhook lookups', async () => {
    await repo.findByAccountId('page-1');
    await repo.findChatRoute('page-1');
    for (const [args] of prisma.client.findFirst.mock.calls as [
      Record<string, unknown>,
    ][]) {
      expect(args).not.toHaveProperty('omit');
    }
  });
});
