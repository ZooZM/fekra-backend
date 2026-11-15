import { ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { TokenCryptoService } from '@app/crypto/token-crypto.service';

const actor = { id: 'a1', name: 'Admin', email: 'admin@example.com' };

describe('ClientsService', () => {
  let service: ClientsService;
  let repo: Record<string, jest.Mock>;
  let crypto: { encrypt: jest.Mock; decrypt: jest.Mock };

  beforeEach(() => {
    repo = Object.fromEntries(
      [
        'create',
        'findAll',
        'findById',
        'findByAccountId',
        'update',
        'delete',
        'findMetaAccountConflict',
        'getClientDataForWorkFlow',
        'setAccessToken',
        'getAccessToken',
        'recordReplyRunActivity',
      ].map((name) => [name, jest.fn()]),
    );
    repo.findMetaAccountConflict.mockResolvedValue(null);
    crypto = {
      encrypt: jest.fn((value, id) => `encrypted:${id}:${value}`),
      decrypt: jest.fn(),
    };
    service = new ClientsService(
      crypto as unknown as TokenCryptoService,
      repo as never,
    );
  });

  it('finds a client by its connected Meta account id', async () => {
    const client = { id: 'c1' };
    repo.findByAccountId.mockResolvedValue(client);

    await expect(service.findByAccountId('page-1')).resolves.toBe(client);
    expect(repo.findByAccountId).toHaveBeenCalledWith('page-1');
  });

  describe('create', () => {
    it('generates an id, encrypts the token and passes the actor', async () => {
      repo.create.mockResolvedValue({ id: 'generated' });
      await service.create(
        { name: 'Client', accessToken: 'secret' } as never,
        actor,
      );
      expect(crypto.encrypt).toHaveBeenCalledWith('secret', expect.any(String));
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          accessToken: expect.stringContaining('encrypted:') as string,
        }),
        actor,
      );
    });

    it.each(['fbPageId', 'instaAccountId'])(
      'refuses a %s that belongs to another client, naming the field',
      async (field) => {
        repo.findMetaAccountConflict.mockResolvedValue(field);
        const error = await service
          .create(
            { name: 'C', accessToken: 't', [field]: '12345' } as never,
            actor,
          )
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toMatchObject({
          errorCode: 'DUPLICATE_KEY_ERROR',
          details: { field },
        });
        expect(repo.create).not.toHaveBeenCalled();
      },
    );
  });

  describe('update', () => {
    it('never encrypts a token: edits do not carry one', async () => {
      repo.update.mockResolvedValue({
        status: 'updated',
        record: { id: 'c1' },
      });
      await service.update('c1', { name: 'New', version: 3 }, actor);
      expect(crypto.encrypt).not.toHaveBeenCalled();
      expect(repo.update).toHaveBeenCalledWith('c1', { name: 'New' }, 3, actor);
    });

    it('excludes the client itself from the duplicate-account check', async () => {
      repo.update.mockResolvedValue({ status: 'unchanged', record: {} });
      await service.update('c1', { fbPageId: '12345', version: 1 }, actor);
      expect(repo.findMetaAccountConflict).toHaveBeenCalledWith(
        { fbPageId: '12345', instaAccountId: undefined },
        'c1',
      );
    });

    it('throws 404 when the repository finds no client', async () => {
      repo.update.mockResolvedValue(null);
      await expect(
        service.update('c1', { version: 1 }, actor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws a version conflict with who and when', async () => {
      const updatedAt = new Date();
      repo.update.mockResolvedValue({
        status: 'conflict',
        currentVersion: 4,
        updatedAt,
        updatedBy: { id: 'a2', name: 'Other' },
      });
      const error = await service
        .update('c1', { version: 3 }, actor)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        errorCode: 'CLIENT_VERSION_CONFLICT',
        details: {
          currentVersion: 4,
          updatedAt,
          updatedBy: { id: 'a2', name: 'Other' },
        },
      });
    });

    it.each(['updated', 'unchanged'])(
      'returns the record when %s',
      async (status) => {
        const record = { id: 'c1' };
        repo.update.mockResolvedValue({ status, record });
        await expect(service.update('c1', { version: 1 }, actor)).resolves.toBe(
          record,
        );
      },
    );
  });

  describe('remove', () => {
    it('passes the actor and throws 404 when nothing was deleted', async () => {
      repo.delete.mockResolvedValue(true);
      await service.remove('c1', actor);
      expect(repo.delete).toHaveBeenCalledWith('c1', actor);
      repo.delete.mockResolvedValue(false);
      await expect(service.remove('c2', actor)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('access token', () => {
    it('encrypts with the client id as AAD and passes the actor', async () => {
      repo.setAccessToken.mockResolvedValue(true);
      await service.setAccessToken('c1', 'plain', actor);
      expect(crypto.encrypt).toHaveBeenCalledWith('plain', 'c1');
      expect(repo.setAccessToken).toHaveBeenCalledWith(
        'c1',
        'encrypted:c1:plain',
        actor,
      );
    });

    it('throws 404 for an unknown client', async () => {
      repo.setAccessToken.mockResolvedValue(false);
      await expect(
        service.setAccessToken('missing', 'plain', actor),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never logs the plaintext token (FR-016)', async () => {
      const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map(
        (level) => jest.spyOn(Logger.prototype, level).mockImplementation(),
      );
      repo.create.mockResolvedValue({ id: 'x' });
      repo.setAccessToken.mockResolvedValue(true);
      await service.create(
        { name: 'C', accessToken: 'super-secret-token' } as never,
        actor,
      );
      await service.setAccessToken('c1', 'super-secret-token', actor);
      const logged = JSON.stringify(spies.flatMap((s) => s.mock.calls));
      expect(logged).not.toContain('super-secret-token');
      spies.forEach((s) => s.mockRestore());
    });

    it('decrypts stored tokens, and returns null when there is none', async () => {
      repo.getAccessToken.mockResolvedValue('stored');
      crypto.decrypt.mockReturnValue('plain');
      await expect(service.getAccessToken('c1')).resolves.toBe('plain');
      repo.getAccessToken.mockResolvedValue(null);
      await expect(service.getAccessToken('c1')).resolves.toBeNull();
    });
  });

  describe('recordReplyRun', () => {
    const details = {
      runId: '3f0e1c2a-8a43-4c55-9b55-0d7b0c7b1e11',
      platform: 'facebook' as const,
      accountId: '114022207011543',
      postId: '114022207011543_100068101366873',
      toAnswer: 8,
    };

    it('records the action for the client name given, with the actor and the details', async () => {
      repo.recordReplyRunActivity.mockResolvedValue(undefined);

      await service.recordReplyRun(
        { id: 'c1', name: 'Acme' },
        'REPLY_RUN_STARTED',
        actor,
        details,
      );

      expect(repo.recordReplyRunActivity).toHaveBeenCalledWith(
        { id: 'c1', name: 'Acme' },
        'REPLY_RUN_STARTED',
        actor,
        details,
      );
    });

    it('does not look the client up, so a stop is still recorded after the client was deleted', async () => {
      repo.recordReplyRunActivity.mockResolvedValue(undefined);
      await service.recordReplyRun(
        { id: 'deleted', name: 'Gone' },
        'REPLY_RUN_STOPPED',
        actor,
        { ...details, handled: 3 },
      );
      expect(repo.findById).not.toHaveBeenCalled();
    });

    it('passes a repository failure on, so the caller can refuse to start the run', async () => {
      repo.recordReplyRunActivity.mockRejectedValue(new Error('db down'));
      await expect(
        service.recordReplyRun(
          { id: 'c1', name: 'Acme' },
          'REPLY_RUN_STARTED',
          actor,
          details,
        ),
      ).rejects.toThrow('db down');
    });
  });

  it('delegates reads and returns the workflow data', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const workflow = { id: 'c1' };
    repo.getClientDataForWorkFlow.mockResolvedValue(workflow);
    await expect(service.getClientDataForWorkFlow('c1')).resolves.toBe(
      workflow,
    );
  });

  describe('ownsAccount (feature 004)', () => {
    const client = { id: 'c1', fbPageId: 'page-1', instaAccountId: 'ig-1' };

    it.each([
      ['its Facebook page', 'FACEBOOK', 'page-1', true],
      ['its Instagram account', 'INSTAGRAM', 'ig-1', true],
      ['another page', 'FACEBOOK', 'page-2', false],
      ['its Instagram id used as a Facebook page', 'FACEBOOK', 'ig-1', false],
      [
        'its page id used as an Instagram account',
        'INSTAGRAM',
        'page-1',
        false,
      ],
    ] as const)('is %p → %p', async (_label, platform, accountId, expected) => {
      repo.findById.mockResolvedValue(client);
      await expect(
        service.ownsAccount('c1', platform, accountId),
      ).resolves.toBe(expected);
      expect(repo.findById).toHaveBeenCalledWith('c1');
    });

    it('is false for an unknown client', async () => {
      repo.findById.mockResolvedValue(null);
      await expect(
        service.ownsAccount('c9', 'FACEBOOK', 'page-1'),
      ).resolves.toBe(false);
    });

    it('is false when the client has no account on that platform', async () => {
      repo.findById.mockResolvedValue({ ...client, instaAccountId: null });
      await expect(
        service.ownsAccount('c1', 'INSTAGRAM', 'ig-1'),
      ).resolves.toBe(false);
    });
  });
});
