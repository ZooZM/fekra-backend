import { OffersRepository } from '@app/offers/repositories/offers.repository.impl';
import { ServicesRepository } from './services.repository.impl';

const CLIENT = '3f0f6a52-7b6c-4b8e-9d57-1c2d3e4f5a6b';

describe.each([
  ['ServicesRepository', ServicesRepository, 'service', 'name'],
  ['OffersRepository', OffersRepository, 'offer', 'title'],
] as const)('%s list', (_name, Repository, model, orderBy) => {
  let delegate: { findMany: jest.Mock; count: jest.Mock };
  let repo: InstanceType<typeof Repository>;

  const query = (over: Record<string, unknown> = {}) =>
    ({
      page: 2,
      limit: 10,
      orderBy,
      orderDir: 'asc',
      ...over,
    }) as never;

  beforeEach(() => {
    delegate = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    };
    const prisma = {
      [model]: delegate,
      $transaction: (ops: Promise<unknown>[]) => Promise.all(ops),
    };
    repo = new Repository(prisma as never);
  });

  it('lists only one client when a clientId is given, for the page and the total', async () => {
    await repo.findAll(query({ clientId: CLIENT }));

    const where = { clientId: CLIENT };
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where }),
    );
    expect(delegate.count).toHaveBeenCalledWith({ where });
  });

  it('lists everything when no clientId is given', async () => {
    await repo.findAll(query());
    expect(delegate.count).toHaveBeenCalledWith({ where: {} });
  });

  it('orders by the field and ends with the id as a stable tiebreaker', async () => {
    await repo.findAll(query());
    expect(delegate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ [orderBy]: 'asc' }, { id: 'asc' }],
        skip: 10,
        take: 10,
      }),
    );
  });
});
