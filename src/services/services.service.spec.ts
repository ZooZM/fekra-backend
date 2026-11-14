import { NotFoundException } from '@nestjs/common';
import { ServicesService } from './services.service';

const CLIENT_A = '3f0f6a52-7b6c-4b8e-9d57-1c2d3e4f5a6b';
const CLIENT_B = '8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OFFER = 'c4f1e0a2-5b6d-4c7e-8f90-a1b2c3d4e5f6';

describe('ServicesService', () => {
  let service: ServicesService;
  let repo: Record<string, jest.Mock>;
  let offers: { findById: jest.Mock };

  const fieldErrors = async (promise: Promise<unknown>) => {
    const error = (await promise.catch((e: unknown) => e)) as {
      getStatus: () => number;
      getResponse: () => {
        errorCode: string;
        details: { fieldErrors: Record<string, string[]> };
      };
    };
    expect(error.getStatus()).toBe(422);
    expect(error.getResponse().errorCode).toBe('INPUT_VALIDATION_ERROR');
    return error.getResponse().details.fieldErrors;
  };

  beforeEach(() => {
    repo = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'delete'].map((name) => [
        name,
        jest.fn(),
      ]),
    );
    repo.findById.mockResolvedValue({ id: 's1', clientId: CLIENT_A });
    offers = {
      findById: jest.fn().mockResolvedValue({ id: OFFER, clientId: CLIENT_A }),
    };
    service = new ServicesService(repo as never, offers as never);
  });

  it('passes create and update data while preserving variants', async () => {
    repo.create.mockResolvedValue({});
    repo.update.mockResolvedValue({});
    const input = {
      clientId: CLIENT_A,
      name: 'Photography',
      variants: [{ name: 'Basic' }],
    };
    await service.create(input as never);
    await service.update('s1', input as never);
    expect(repo.create).toHaveBeenCalledWith(input);
    expect(repo.update).toHaveBeenCalledWith('s1', input);
  });

  it('delegates list and delete operations', async () => {
    repo.findAll.mockResolvedValue({ data: [], meta: {} });
    await expect(service.findAll({} as never)).resolves.toEqual({
      data: [],
      meta: {},
    });
    await service.remove('s1');
    expect(repo.delete).toHaveBeenCalledWith('s1');
  });

  it('throws when a service is missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('the offer of a service', () => {
    it('can be an offer of the same client', async () => {
      repo.create.mockResolvedValue({});
      await service.create({
        clientId: CLIENT_A,
        name: 'Cut',
        offerId: OFFER,
      } as never);
      expect(offers.findById).toHaveBeenCalledWith(OFFER);
      expect(repo.create).toHaveBeenCalled();
    });

    it('cannot be an offer of another client (422 on offerId, nothing saved)', async () => {
      offers.findById.mockResolvedValue({ id: OFFER, clientId: CLIENT_B });

      const errors = await fieldErrors(
        service.create({
          clientId: CLIENT_A,
          name: 'Cut',
          offerId: OFFER,
        } as never),
      );

      expect(errors.offerId).toEqual(['Choose an offer of this client']);
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('cannot be an offer that does not exist (the same field error)', async () => {
      offers.findById.mockRejectedValue(
        new NotFoundException('Offer not found'),
      );

      const errors = await fieldErrors(
        service.create({
          clientId: CLIENT_A,
          name: 'Cut',
          offerId: OFFER,
        } as never),
      );

      expect(errors.offerId).toEqual(['Offer not found']);
    });

    it('passes a failure of the offers lookup on instead of hiding it', async () => {
      offers.findById.mockRejectedValue(new Error('database down'));
      await expect(
        service.create({
          clientId: CLIENT_A,
          name: 'Cut',
          offerId: OFFER,
        } as never),
      ).rejects.toThrow('database down');
    });

    it('is not checked when there is none, and can be cleared with null', async () => {
      repo.create.mockResolvedValue({});
      repo.update.mockResolvedValue({});
      await service.create({ clientId: CLIENT_A, name: 'Cut' } as never);
      await service.update('s1', { offerId: null } as never);
      expect(offers.findById).not.toHaveBeenCalled();
    });

    it('is checked against the stored client on an update', async () => {
      offers.findById.mockResolvedValue({ id: OFFER, clientId: CLIENT_B });

      const errors = await fieldErrors(
        service.update('s1', { offerId: OFFER } as never),
      );

      expect(errors.offerId).toEqual(['Choose an offer of this client']);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('answers not found for a service that does not exist', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.update('missing', { name: 'x' } as never),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('refuses to move a service to another client (422 on clientId)', async () => {
      const errors = await fieldErrors(
        service.update('s1', { clientId: CLIENT_B } as never),
      );
      expect(errors.clientId).toHaveLength(1);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('still accepts the same clientId, so existing requests keep working', async () => {
      repo.update.mockResolvedValue({});
      await service.update('s1', { clientId: CLIENT_A, name: 'x' } as never);
      expect(repo.update).toHaveBeenCalledTimes(1);
    });
  });
});
