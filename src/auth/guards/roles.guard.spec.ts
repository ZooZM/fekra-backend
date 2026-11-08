import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const context = (user?: { roles: string[] }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as never;

  it('allows routes without required roles', () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue([]) };
    expect(new RolesGuard(reflector as never).canActivate(context())).toBe(
      true,
    );
  });

  it('requires an authenticated user with at least one required role', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ADMIN']),
    };
    const guard = new RolesGuard(reflector as never);
    expect(guard.canActivate(context())).toBe(false);
    expect(guard.canActivate(context({ roles: ['USER'] }))).toBe(false);
    expect(guard.canActivate(context({ roles: ['ADMIN'] }))).toBe(true);
  });
});
