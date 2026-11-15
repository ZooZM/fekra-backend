import { NotFoundException } from '@nestjs/common';
import { BusinessInfoService } from './business-info.service';

const CLIENT = '3f0f6a52-7b6c-4b8e-9d57-1c2d3e4f5a6b';
const OTHER = '8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('BusinessInfoService', () => {
  let service: BusinessInfoService;
  let repo: Record<string, jest.Mock>;

  beforeEach(() => {
    repo = Object.fromEntries(
      ['create', 'findByClientId', 'update', 'delete'].map((name) => [
        name,
        jest.fn(),
      ]),
    );
    service = new BusinessInfoService(repo as never);
  });

  describe('findByClientId', () => {
    it('returns the record', async () => {
      const record = { clientId: CLIENT };
      repo.findByClientId.mockResolvedValue(record);
      await expect(service.findByClientId(CLIENT)).resolves.toBe(record);
    });

    it('answers not found when the client has none yet', async () => {
      repo.findByClientId.mockResolvedValue(null);
      await expect(service.findByClientId(CLIENT)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('takes the client from the path', async () => {
      repo.create.mockResolvedValue({});
      await service.create(CLIENT, { phone: '0100' } as never);
      expect(repo.create).toHaveBeenCalledWith({
        phone: '0100',
        clientId: CLIENT,
      });
    });

    it('accepts a body clientId that matches the path', async () => {
      repo.create.mockResolvedValue({});
      await service.create(CLIENT, { clientId: CLIENT } as never);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('refuses a body clientId that differs from the path (422 on clientId)', async () => {
      const error = (await Promise.resolve()
        .then(() => service.create(CLIENT, { clientId: OTHER } as never))
        .catch((e: unknown) => e)) as {
        getStatus: () => number;
        getResponse: () => {
          details: { fieldErrors: Record<string, string[]> };
        };
      };
      expect(error.getStatus()).toBe(422);
      expect(error.getResponse().details.fieldErrors.clientId).toHaveLength(1);
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('sends only the fields that were sent, so the others stay unchanged', async () => {
      repo.update.mockResolvedValue({});
      await service.update(CLIENT, { clientId: CLIENT, phone: '0100' });
      expect(repo.update).toHaveBeenCalledWith(CLIENT, { phone: '0100' });
    });

    it('passes null through, which clears a nullable field', async () => {
      repo.update.mockResolvedValue({});
      await service.update(CLIENT, { website: null, location: null });
      expect(repo.update).toHaveBeenCalledWith(CLIENT, {
        website: null,
        location: null,
      });
    });

    it('refuses a body clientId that differs from the path (422 on clientId)', () => {
      let thrown: { getResponse: () => unknown } | undefined;
      try {
        void service.update(CLIENT, { clientId: OTHER, phone: '1' });
      } catch (e) {
        thrown = e as { getResponse: () => unknown };
      }
      expect(thrown?.getResponse()).toMatchObject({
        errorCode: 'INPUT_VALIDATION_ERROR',
        details: {
          fieldErrors: { clientId: [expect.stringMatching(/match/)] },
        },
      });
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  it('deletes by client', async () => {
    await service.remove(CLIENT);
    expect(repo.delete).toHaveBeenCalledWith(CLIENT);
  });
});
