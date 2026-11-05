import { ClientsService } from './clients.service';
import { CLIENTS_REPOSITORY } from './repositories/IClientsRepository.repository';
import { TokenCryptoService } from '@app/crypto/token-crypto.service';
import { NotFoundException } from '@nestjs/common';

describe('ClientsService', () => {
  let service: ClientsService;
  let repo: Record<string, jest.Mock>;
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(() => {
    repo = Object.fromEntries(
      ['create', 'findAll', 'findById', 'update', 'delete', 'getClientDataForWorkFlow',
        'setAccessToken', 'getAccessToken'].map((name) => [name, jest.fn()]),
    );
    crypto = { encrypt: jest.fn((value, id) => `encrypted:${id}:${value}`), decrypt: jest.fn() };
    service = new ClientsService(
      crypto as unknown as TokenCryptoService,
      repo as never,
    );
  });

  it('generates an id and encrypts access tokens on create', async () => {
    repo.create.mockResolvedValue({ id: 'generated' });
    await service.create({ name: 'Client', accessToken: 'secret' } as never);
    expect(crypto.encrypt).toHaveBeenCalledWith('secret', expect.any(String));
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: expect.stringContaining('encrypted:') }),
    );
  });

  it('encrypts a supplied token on update but preserves omitted tokens', async () => {
    repo.update.mockResolvedValue({});
    await service.update('c1', { name: 'Updated' } as never);
    expect(crypto.encrypt).not.toHaveBeenCalled();
    await service.update('c1', { accessToken: 'new' } as never);
    expect(crypto.encrypt).toHaveBeenCalledWith('new', 'c1');
  });

  it('throws for missing clients and delegates other operations', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(NotFoundException);
    const workflow = { id: 'c1' };
    repo.getClientDataForWorkFlow.mockResolvedValue(workflow);
    await expect(service.getClientDataForWorkFlow('c1')).resolves.toBe(workflow);
    await service.remove('c1');
    expect(repo.delete).toHaveBeenCalledWith('c1');
  });

  it('encrypts and decrypts stored access tokens, including null', async () => {
    repo.getAccessToken.mockResolvedValue('stored');
    crypto.decrypt.mockReturnValue('plain');
    await expect(service.getAccessToken('c1')).resolves.toBe('plain');
    repo.getAccessToken.mockResolvedValue(null);
    await expect(service.getAccessToken('c1')).resolves.toBeNull();
    await service.setAccessToken('c1', 'plain');
    expect(repo.setAccessToken).toHaveBeenCalledWith('c1', expect.any(String));
  });
});
