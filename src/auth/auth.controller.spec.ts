import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LocalGuard } from './guards/local.guard';
import { OriginGuard } from './guards/origin.guard';
import { JwtAuthGuard } from './guards/jwt.guard';
import { RolesGuard } from './guards/roles.guard';
import { ROLES_KEY } from './decorators/roles.decorator';

describe('AuthController', () => {
  let controller: AuthController;
  let auth: { registerUser: jest.Mock; generateJwt: jest.Mock };
  let sessions: {
    refresh: jest.Mock;
    revoke: jest.Mock;
    policy: { idleTimeoutMinutes?: number };
  };
  let users: { findById: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };
  const config = {
    get: (key: string) =>
      ({ NODE_ENV: 'production', SESSION_COOKIE_PATH: '/api/auth' })[key],
  };

  beforeEach(() => {
    auth = { registerUser: jest.fn(), generateJwt: jest.fn() };
    sessions = {
      refresh: jest.fn(),
      revoke: jest.fn(),
      policy: { idleTimeoutMinutes: 30 },
    };
    users = { findById: jest.fn() };
    res = { cookie: jest.fn(), clearCookie: jest.fn() };
    controller = new AuthController(
      auth as never,
      sessions as never,
      users as never,
      config as never,
    );
  });

  it('registers through the auth service', async () => {
    const dto = { name: 'A' };
    auth.registerUser.mockResolvedValue('result');
    await expect(controller.register(dto as never)).resolves.toBe('result');
    expect(auth.registerUser).toHaveBeenCalledWith(dto);
  });

  it('login sets the httpOnly session cookie and returns the user, token and idle limit', () => {
    const request = {
      user: {
        user: { id: 'u1' },
        token: 'jwt',
        session: {
          cookieValue: 'cookie-value',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      },
    };
    expect(controller.login(request as never, res as never)).toEqual({
      user: { id: 'u1' },
      token: 'jwt',
      idleTimeoutMinutes: 30,
    });
    const [name, value, options] = res.cookie.mock.calls[0] as [
      string,
      string,
      { maxAge: number },
    ];
    expect(name).toBe('fekra_session');
    expect(value).toBe('cookie-value');
    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/api/auth',
    });
    expect(options.maxAge).toBeGreaterThan(3_500_000);
  });

  it('uses the local guard on login and the origin guard on refresh and logout', () => {
    const guards = (name: keyof AuthController) =>
      Reflect.getMetadata('__guards__', AuthController.prototype[name]);
    expect(guards('login')).toContain(LocalGuard);
    expect(guards('refresh')).toContain(OriginGuard);
    expect(guards('logout')).toContain(OriginGuard);
  });

  it('only lets an ADMIN register an account', () => {
    const handler = AuthController.prototype.register;
    expect(Reflect.getMetadata('__guards__', handler)).toEqual([
      JwtAuthGuard,
      RolesGuard,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['ADMIN']);
  });

  it('login without limits sets a cookie of at most 400 days and reports no idle limit', () => {
    sessions.policy = {};
    const request = {
      user: {
        user: { id: 'u1' },
        token: 'jwt',
        session: {
          cookieValue: 'cookie-value',
          expiresAt: new Date(Date.now() + 10 * 365 * 24 * 3_600_000),
        },
      },
    };
    expect(controller.login(request as never, res as never)).toEqual({
      user: { id: 'u1' },
      token: 'jwt',
    });
    const [, , options] = res.cookie.mock.calls[0] as [
      string,
      string,
      { maxAge: number },
    ];
    expect(options.maxAge).toBe(400 * 24 * 3_600_000);
  });

  it('refresh returns a new token carrying the session id', async () => {
    sessions.refresh.mockResolvedValue({
      sessionId: 's1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    users.findById.mockResolvedValue({ id: 'u1', roles: ['ADMIN'] });
    auth.generateJwt.mockResolvedValue('new-jwt');

    await expect(
      controller.refresh(
        { cookies: { fekra_session: 'c' } } as never,
        res as never,
      ),
    ).resolves.toEqual({
      user: { id: 'u1', roles: ['ADMIN'] },
      token: 'new-jwt',
      idleTimeoutMinutes: 30,
    });
    expect(sessions.refresh).toHaveBeenCalledWith('c');
    expect(auth.generateJwt).toHaveBeenCalledWith({
      sub: 'u1',
      userRoles: ['ADMIN'],
      sid: 's1',
    });
  });

  it('without limits, refresh renews the cookie for at most 400 days and omits the idle limit', async () => {
    sessions.policy = {};
    sessions.refresh.mockResolvedValue({
      sessionId: 's1',
      userId: 'u1',
      expiresAt: new Date(Date.now() + 10 * 365 * 24 * 3_600_000),
    });
    users.findById.mockResolvedValue({ id: 'u1', roles: ['ADMIN'] });
    auth.generateJwt.mockResolvedValue('new-jwt');

    const result = await controller.refresh(
      { cookies: { fekra_session: 'c' } } as never,
      res as never,
    );

    expect(result).toEqual({
      user: { id: 'u1', roles: ['ADMIN'] },
      token: 'new-jwt',
    });
    expect(res.cookie).toHaveBeenCalledWith(
      'fekra_session',
      'c',
      expect.objectContaining({ maxAge: 400 * 24 * 3_600_000, httpOnly: true }),
    );
  });

  it('refresh clears the cookie and rethrows when the session is expired', async () => {
    const expired = new UnauthorizedException({ errorCode: 'SESSION_EXPIRED' });
    sessions.refresh.mockRejectedValue(expired);
    await expect(
      controller.refresh({ cookies: {} } as never, res as never),
    ).rejects.toBe(expired);
    expect(res.clearCookie).toHaveBeenCalledWith(
      'fekra_session',
      expect.anything(),
    );
  });

  it('refresh treats a deleted user as an expired session', async () => {
    sessions.refresh.mockResolvedValue({ sessionId: 's1', userId: 'gone' });
    users.findById.mockRejectedValue(new Error('User not found'));
    const err = await controller
      .refresh({ cookies: { fekra_session: 'c' } } as never, res as never)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnauthorizedException);
    expect((err as UnauthorizedException).getResponse()).toMatchObject({
      errorCode: 'SESSION_EXPIRED',
    });
  });

  it('logout revokes the session and clears the cookie, even without a cookie', async () => {
    await controller.logout(
      { cookies: { fekra_session: 'c' } } as never,
      res as never,
    );
    expect(sessions.revoke).toHaveBeenCalledWith('c');
    await controller.logout({} as never, res as never);
    expect(sessions.revoke).toHaveBeenLastCalledWith(undefined);
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });
});
