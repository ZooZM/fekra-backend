import { createHash } from 'node:crypto';
import { LoginThrottleService } from './login-throttle.service';

describe('LoginThrottleService', () => {
  let redis: Record<string, jest.Mock>;
  let env: Record<string, unknown>;
  let service: LoginThrottleService;
  const key = (email: string) =>
    `auth:login-fail:${createHash('sha256').update(email).digest('hex')}`;

  beforeEach(() => {
    redis = {
      get: jest.fn(),
      incr: jest.fn(),
      expire: jest.fn(),
      del: jest.fn(),
    };
    env = {};
    service = new LoginThrottleService(
      redis as never,
      { get: (k: string) => env[k] } as never,
    );
  });

  it('stores only a hash of the normalized email in the key', async () => {
    redis.get.mockResolvedValue(null);
    await service.isBlocked('  A@B.com ');
    expect(redis.get).toHaveBeenCalledWith(key('a@b.com'));
    expect(redis.get.mock.calls[0][0]).not.toContain('a@b.com');
  });

  it.each([
    [null, false],
    ['4', false],
    ['5', true],
    ['9', true],
  ])('isBlocked with count %p → %p', async (count, expected) => {
    redis.get.mockResolvedValue(count);
    await expect(service.isBlocked('a@b.com')).resolves.toBe(expected);
  });

  it('starts a 15 minute window on the first failure only', async () => {
    redis.incr.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await service.recordFailure('a@b.com');
    await service.recordFailure('a@b.com');
    expect(redis.expire).toHaveBeenCalledTimes(1);
    expect(redis.expire).toHaveBeenCalledWith(key('a@b.com'), 900);
  });

  it('restarts the window when the limit is reached, so the block lasts 15 minutes', async () => {
    redis.incr.mockResolvedValue(5);
    await service.recordFailure('a@b.com');
    expect(redis.expire).toHaveBeenCalledWith(key('a@b.com'), 900);
  });

  it('does not extend the block for failures past the limit', async () => {
    redis.incr.mockResolvedValue(6);
    await service.recordFailure('a@b.com');
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('uses the configured limit and window', async () => {
    env.LOGIN_MAX_FAILURES = '3';
    env.LOGIN_BLOCK_MINUTES = '1';
    redis.get.mockResolvedValue('3');
    await expect(service.isBlocked('a@b.com')).resolves.toBe(true);
    redis.incr.mockResolvedValue(3);
    await service.recordFailure('a@b.com');
    expect(redis.expire).toHaveBeenCalledWith(key('a@b.com'), 60);
  });

  it('reset deletes the counter', async () => {
    await service.reset('A@b.com');
    expect(redis.del).toHaveBeenCalledWith(key('a@b.com'));
  });
});
