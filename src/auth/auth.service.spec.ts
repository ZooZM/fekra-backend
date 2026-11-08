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
  let sessions: { start: jest.Mock };
  let throttle: {
    isBlocked: jest.Mock;
    recordFailure: jest.Mock;
    reset: jest.Mock;
  };

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
    sessions = {
      start: jest.fn().mockResolvedValue({
        sessionId: 's1',
        cookieValue: 'cookie',
        expiresAt: new Date('2030-01-01'),
      }),
    };
    throttle = {
      isBlocked: jest.fn().mockResolvedValue(false),
      recordFailure: jest.fn(),
      reset: jest.fn(),
    };
    service = new AuthService(
      usersService as unknown as UsersService,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      sessions as never,
      throttle as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('signs JWTs with configured credentials', async () => {
    await expect(
      service.generateJwt({ sub: 'u1', userRoles: [] }),
    ).resolves.toBe('token');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { sub: 'u1', userRoles: [] },
      { secret: 'secret', expiresIn: '1h' },
    );
  });

  it.each([
    [null, true],
    [{ id: 'u1', passwordHash: 'hash', roles: [] }, false],
  ])(
    'rejects invalid credentials and counts the failure',
    async (user, match) => {
      usersService.findByEmailWithPassword.mockResolvedValue(user);
      jest.spyOn(authConstants, 'compare').mockResolvedValue(match);
      await expect(
        service.validateUser('A@B.com ', 'password'),
      ).rejects.toThrow('Invalid credentials');
      expect(throttle.recordFailure).toHaveBeenCalledWith('a@b.com');
      expect(sessions.start).not.toHaveBeenCalled();
    },
  );

  it('refuses a blocked email with the same error, even with the right password', async () => {
    throttle.isBlocked.mockResolvedValue(true);
    const compare = jest
      .spyOn(authConstants, 'compare')
      .mockResolvedValue(true);
    await expect(service.validateUser('a@b.com', 'password')).rejects.toThrow(
      'Invalid credentials',
    );
    // no lookup and no extra failure, but bcrypt still runs so timing doesn't leak the block
    expect(usersService.findByEmailWithPassword).not.toHaveBeenCalled();
    expect(compare).toHaveBeenCalled();
    expect(throttle.recordFailure).not.toHaveBeenCalled();
    expect(sessions.start).not.toHaveBeenCalled();
  });

  it('starts a session and returns a password-free user with a session token', async () => {
    const user = {
      id: 'u1',
      email: 'a@b.com',
      passwordHash: 'hash',
      roles: ['ADMIN'],
    };
    usersService.findByEmailWithPassword.mockResolvedValue(user);
    jest.spyOn(authConstants, 'compare').mockResolvedValue(true);

    await expect(service.validateUser(user.email, 'password')).resolves.toEqual(
      {
        user: { id: 'u1', email: 'a@b.com', roles: ['ADMIN'] },
        token: 'token',
        session: { cookieValue: 'cookie', expiresAt: new Date('2030-01-01') },
      },
    );
    expect(throttle.reset).toHaveBeenCalledWith('a@b.com');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { sub: 'u1', userRoles: ['ADMIN'], sid: 's1' },
      expect.anything(),
    );
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
      service.registerUser({
        name: 'A',
        email: 'a@b.com',
        password: 'password',
      }),
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
