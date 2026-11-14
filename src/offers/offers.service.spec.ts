import { OffersService } from './offers.service';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@app/generated/prisma/client';

const CLIENT_A = '3f0f6a52-7b6c-4b8e-9d57-1c2d3e4f5a6b';
const CLIENT_B = '8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('OffersService', () => {
  let service: OffersService;
  let repo: Record<string, jest.Mock>;

  beforeEach(() => {
    repo = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'delete'].map((name) => [
        name,
        jest.fn(),
      ]),
    );
    repo.findById.mockResolvedValue({ id: 'o1', clientId: CLIENT_A });
    service = new OffersService(repo as never);
  });

  it('delegates create, list, and delete operations', async () => {
    repo.create.mockResolvedValue({});
    repo.findAll.mockResolvedValue({ data: [], meta: {} });
    await service.create({} as never);
    await expect(service.findAll({} as never)).resolves.toEqual({
      data: [],
      meta: {},
    });
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
    await expect(service.findById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('update', () => {
    it('answers not found for an offer that does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.update('missing', { title: 'x' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses to move an offer to another client (422 on clientId)', async () => {
      const error = (await service
        .update('o1', { clientId: CLIENT_B } as never)
        .catch((e: unknown) => e)) as {
        getStatus: () => number;
        getResponse: () => {
          details: { fieldErrors: Record<string, string[]> };
        };
      };

      expect(error.getStatus()).toBe(422);
      expect(error.getResponse().details.fieldErrors.clientId).toHaveLength(1);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('still accepts the same clientId', async () => {
      repo.update.mockResolvedValue({});
      await service.update('o1', { clientId: CLIENT_A, title: 'x' } as never);
      expect(repo.update).toHaveBeenCalledTimes(1);
    });
  });
});
