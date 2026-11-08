import { UnauthorizedException } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { LocalGuard } from './guards/local.guard';
import { OriginGuard } from './guards/origin.guard';

describe('AuthController', () => {
  let controller: AuthController;
  let auth: { registerUser: jest.Mock; generateJwt: jest.Mock };
  let sessions: { refresh: jest.Mock; revoke: jest.Mock };
  let users: { findById: jest.Mock };
  let res: { cookie: jest.Mock; clearCookie: jest.Mock };
  const config = {
    get: (key: string) =>
      ({ NODE_ENV: 'production', SESSION_COOKIE_PATH: '/api/auth' })[key],
  };

  beforeEach(() => {
    auth = { registerUser: jest.fn(), generateJwt: jest.fn() };
    sessions = { refresh: jest.fn(), revoke: jest.fn() };
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

  it('login sets the httpOnly session cookie and returns only user and token', () => {
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

  it('refresh returns a new token carrying the session id', async () => {
    sessions.refresh.mockResolvedValue({ sessionId: 's1', userId: 'u1' });
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
    });
    expect(sessions.refresh).toHaveBeenCalledWith('c');
    expect(auth.generateJwt).toHaveBeenCalledWith({
      sub: 'u1',
      userRoles: ['ADMIN'],
      sid: 's1',
    });
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
