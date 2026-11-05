import { AuthService } from './auth.service';
import { UsersService } from '@app/users/users.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as authConstants from './consts/auth.contants';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: { findByEmailWithPassword: jest.Mock; create: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };

  beforeEach(() => {
    usersService = {
      findByEmailWithPassword: jest.fn(),
      create: jest.fn(),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('token') };
    configService = {
      getOrThrow: jest.fn((key: string) =>
        key === 'JWT_SECRET' ? 'secret' : '1h',
      ),
    };
    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
    );
  });

  it('signs JWTs with configured credentials', async () => {
    await expect(service.generateJwt({ sub: 'u1', userRoles: [] })).resolves.toBe(
      'token',
    );
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { sub: 'u1', userRoles: [] },
      { secret: 'secret', expiresIn: '1h' },
    );
  });

  it.each([
    [null, true],
    [{ id: 'u1', passwordHash: 'hash', roles: [] }, false],
  ])('rejects invalid credentials', async (user, match) => {
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    jest.spyOn(authConstants, 'compare').mockResolvedValue(match);
    await expect(service.validateUser('a@b.com', 'password')).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('returns a password-free user and token for valid credentials', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.com',
      passwordHash: 'hash',
      roles: ['ADMIN'],
    };
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    jest.spyOn(authConstants, 'compare').mockResolvedValue(true);

    await expect(service.validateUser(user.email, 'password')).resolves.toEqual({
      user: { id: 'u1', email: 'a@b.com', roles: ['ADMIN'] },
      token: 'token',
    });
  });

  it('hashes registration passwords and creates a token', async () => {
    jest.spyOn(authConstants, 'hash').mockResolvedValue('hashed');
    usersService.create.mockResolvedValue({
      id: 'u1',
      name: 'A',
      email: 'a@b.com',
      roles: [],
    });

    await expect(
      service.registerUser({ name: 'A', email: 'a@b.com', password: 'password' }),
    ).resolves.toEqual({
      user: { id: 'u1', name: 'A', email: 'a@b.com', roles: [] },
      token: 'token',
    });
    expect(usersService.create).toHaveBeenCalledWith({
      name: 'A',
      email: 'a@b.com',
      passwordHash: 'hashed',
    });
  });
});
