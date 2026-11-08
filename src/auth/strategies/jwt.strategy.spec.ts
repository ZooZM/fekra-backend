import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let users: { findByIdWithPassowrdChangedAt: jest.Mock };
  let sessions: { isActive: jest.Mock };
  let strategy: JwtStrategy;
  const iat = 1_900_000_000;

  beforeEach(() => {
    users = {
      findByIdWithPassowrdChangedAt: jest.fn().mockResolvedValue({
        id: 'u1',
        roles: ['ADMIN'],
        passwordChangedAt: null,
      }),
    };
    sessions = { isActive: jest.fn().mockResolvedValue(true) };
    strategy = new JwtStrategy(
      users as never,
      sessions as never,
      { getOrThrow: () => 'secret' } as never,
    );
  });

  it('accepts a token without a session id (issued before sessions existed)', async () => {
    await expect(
      strategy.validate({ sub: 'u1', iat, exp: iat + 600 }),
    ).resolves.toMatchObject({
      id: 'u1',
    });
    expect(sessions.isActive).not.toHaveBeenCalled();
  });

  it('accepts a token whose session is active', async () => {
    await strategy.validate({ sub: 'u1', iat, exp: iat + 600, sid: 's1' });
    expect(sessions.isActive).toHaveBeenCalledWith('s1');
  });

  it('rejects a token whose session was revoked or expired', async () => {
    sessions.isActive.mockResolvedValue(false);
    await expect(
      strategy.validate({ sub: 'u1', iat, exp: iat + 600, sid: 's1' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.findByIdWithPassowrdChangedAt).not.toHaveBeenCalled();
  });

  it('rejects a token for a deleted user', async () => {
    users.findByIdWithPassowrdChangedAt.mockRejectedValue(
      new NotFoundException(),
    );
    await expect(
      strategy.validate({ sub: 'u1', iat, exp: iat + 600 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token issued before the last password change', async () => {
    users.findByIdWithPassowrdChangedAt.mockResolvedValue({
      id: 'u1',
      passwordChangedAt: new Date((iat + 1) * 1000),
    });
    await expect(
      strategy.validate({ sub: 'u1', iat, exp: iat + 600 }),
    ).rejects.toThrow('Password was changed');
  });
});
