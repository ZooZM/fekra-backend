import { OffersService } from './offers.service';
import { OFFERS_REPOSITORY } from './repositories/IOffersRepository.repository';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@app/generated/prisma/client';

describe('OffersService', () => {
  let service: OffersService;
  let repo: Record<string, jest.Mock>;

  beforeEach(() => {
    repo = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'delete'].map((name) => [name, jest.fn()]),
    );
    service = new OffersService(repo as never);
  });

  it('delegates create, list, and delete operations', async () => {
    repo.create.mockResolvedValue({});
    repo.findAll.mockResolvedValue({ data: [], meta: {} });
    await service.create({} as never);
    await expect(service.findAll({} as never)).resolves.toEqual({ data: [], meta: {} });
    await service.remove('o1');
    expect(repo.create).toHaveBeenCalledWith({});
    expect(repo.delete).toHaveBeenCalledWith('o1');
  });

  it('converts an explicitly supplied discount to Decimal', async () => {
    repo.update.mockResolvedValue({});
    await service.update('o1', { discountValue: '12.50' } as never);
    const update = repo.update.mock.calls[0][1];
    expect(update.discountValue).toBeInstanceOf(Prisma.Decimal);
    expect(update.discountValue.toString()).toBe('12.5');
  });

  it('does not add a discount when it was omitted', async () => {
    repo.update.mockResolvedValue({});
    await service.update('o1', { title: 'Sale' } as never);
    expect(repo.update).toHaveBeenCalledWith('o1', { title: 'Sale' });
  });

  it('throws when an offer is missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
