import { UsersService } from './users.service';
import { USERS_REPOSITORY } from './repositories/IUsersRepository.repository';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as authConstants from '@app/auth/consts/auth.contants';

describe('UsersService', () => {
  let service: UsersService;
  let repo: Record<string, jest.Mock>;

  beforeEach(() => {
    repo = Object.fromEntries(
      ['findAll', 'findById', 'findByIdWithPassowrdChangedAt', 'findByEmail',
        'findByEmailWithPassword', 'create', 'update', 'updatePasswordHash',
        'updateEmail', 'setRoles', 'setResetToken', 'delete'].map((name) => [
        name,
        jest.fn(),
      ]),
    );
    service = new UsersService(repo as never);
  });

  it('delegates read operations and returns repository values', async () => {
    const result = { data: [], meta: {} };
    repo.findAll.mockResolvedValue(result);
    await expect(service.findAll({} as never)).resolves.toBe(result);
    repo.findByEmail.mockResolvedValue(null);
    await expect(service.findByEmail('a@b.com')).resolves.toBeNull();
  });

  it.each(['findById', 'findByIdWithPassowrdChangedAt'])(
    'throws when %s cannot find a user',
    async (method) => {
      repo[method].mockResolvedValue(null);
      const call = (service as unknown as Record<string, (id: string) => Promise<unknown>>)[method];
      await expect(call.call(service, 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    },
  );

  it('creates public users without admin fields', async () => {
    repo.create.mockResolvedValue({ id: 'u1' });
    const input = { name: 'A', email: 'a@b.com', passwordHash: 'hash' };
    await expect(service.create(input)).resolves.toEqual({ id: 'u1' });
    expect(repo.create).toHaveBeenCalledWith(input);
  });

  it('hashes passwords for admin creation and updates', async () => {
    jest.spyOn(authConstants, 'hash').mockResolvedValue('hashed');
    repo.create.mockResolvedValue({});
    await service.adminCreate({
      name: 'A',
      email: 'a@b.com',
      password: 'password',
      roles: [],
      clientId: undefined,
    });
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: 'hashed' }));

    repo.update.mockResolvedValue({});
    await service.adminUpdate('u1', { password: 'new-password' });
    expect(repo.update).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ passwordHash: 'hashed' }),
    );
  });

  it('rejects empty profile updates', async () => {
    await expect(service.update('u1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('delegates sensitive changes and deletion', async () => {
    jest.spyOn(authConstants, 'hash').mockResolvedValue('hashed');
    await service.updatePassword('u1', 'password');
    await service.updateEmail('u1', 'new@b.com');
    await service.setRoles('u1', ['ADMIN'] as never);
    await service.setResetToken('u1', 'digest', new Date());
    await service.remove('u1');
    expect(repo.updatePasswordHash).toHaveBeenCalledWith('u1', 'hashed');
    expect(repo.updateEmail).toHaveBeenCalled();
    expect(repo.setRoles).toHaveBeenCalled();
    expect(repo.setResetToken).toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith('u1');
  });
});
