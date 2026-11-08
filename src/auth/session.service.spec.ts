import { createHash } from 'node:crypto';
import { SessionService } from './session.service';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

describe('SessionService', () => {
  const NOW = new Date('2030-01-01T12:00:00Z');
  let repo: Record<string, jest.Mock>;
  let env: Record<string, unknown>;
  let service: SessionService;

  const session = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    userId: 'u1',
    expiresAt: new Date(NOW.getTime() + 6 * 3_600_000),
    lastUsedAt: new Date(NOW.getTime() - 5 * 60_000),
    revokedAt: null,
    ...over,
  });

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    repo = Object.fromEntries(
      ['create', 'findByTokenHash', 'findById', 'touch', 'revoke'].map((n) => [
        n,
        jest.fn(),
      ]),
    );
    env = {};
    service = new SessionService(
      repo as never,
      { get: (k: string) => env[k] } as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  describe('start', () => {
    it('stores only the hash of a random cookie value, expiring after 12 hours', async () => {
      repo.create.mockResolvedValue({ id: 's1' });
      const result = await service.start('u1');
      expect(result.sessionId).toBe('s1');
      expect(result.cookieValue.length).toBeGreaterThanOrEqual(43);
      expect(result.expiresAt).toEqual(
        new Date(NOW.getTime() + 12 * 3_600_000),
      );
      expect(repo.create).toHaveBeenCalledWith({
        userId: 'u1',
        tokenHash: sha256(result.cookieValue),
        expiresAt: result.expiresAt,
      });
      expect(JSON.stringify(repo.create.mock.calls)).not.toContain(
        result.cookieValue,
      );
    });

    it('uses the configured maximum', async () => {
      env.SESSION_MAX_HOURS = '2';
      repo.create.mockResolvedValue({ id: 's1' });
      const { expiresAt } = await service.start('u1');
      expect(expiresAt).toEqual(new Date(NOW.getTime() + 2 * 3_600_000));
    });
  });

  describe('refresh', () => {
    const expired = { response: { errorCode: 'SESSION_EXPIRED' } };

    it('extends an active session and returns its identity', async () => {
      repo.findByTokenHash.mockResolvedValue(session());
      await expect(service.refresh('cookie')).resolves.toMatchObject({
        sessionId: 's1',
        userId: 'u1',
      });
      expect(repo.findByTokenHash).toHaveBeenCalledWith(sha256('cookie'));
      expect(repo.touch).toHaveBeenCalledWith('s1', NOW);
    });

    it.each([
      ['no cookie', undefined, null],
      ['unknown session', 'cookie', null],
      ['revoked', 'cookie', session({ revokedAt: new Date() })],
      [
        'past the 12 h limit',
        'cookie',
        session({ expiresAt: new Date(NOW.getTime() - 1) }),
      ],
      [
        'exactly at the 12 h limit',
        'cookie',
        session({ expiresAt: new Date(NOW.getTime()) }),
      ],
      [
        'idle for 30 minutes',
        'cookie',
        session({ lastUsedAt: new Date(NOW.getTime() - 30 * 60_000) }),
      ],
    ])('refuses: %s', async (_name, cookie, row) => {
      repo.findByTokenHash.mockResolvedValue(row);
      await expect(service.refresh(cookie)).rejects.toMatchObject(expired);
      expect(repo.touch).not.toHaveBeenCalled();
    });

    it('accepts a session idle for just under 30 minutes', async () => {
      repo.findByTokenHash.mockResolvedValue(
        session({ lastUsedAt: new Date(NOW.getTime() - 29 * 60_000) }),
      );
      await expect(service.refresh('cookie')).resolves.toBeDefined();
    });

    it('uses the configured idle limit', async () => {
      env.SESSION_IDLE_MINUTES = '1';
      repo.findByTokenHash.mockResolvedValue(
        session({ lastUsedAt: new Date(NOW.getTime() - 61_000) }),
      );
      await expect(service.refresh('cookie')).rejects.toMatchObject(expired);
    });
  });

  describe('revoke', () => {
    it('revokes the matching session', async () => {
      repo.findByTokenHash.mockResolvedValue(session());
      await service.revoke('cookie');
      expect(repo.revoke).toHaveBeenCalledWith('s1', NOW);
    });

    it('ignores a missing cookie or an unknown session', async () => {
      await service.revoke(undefined);
      repo.findByTokenHash.mockResolvedValue(null);
      await service.revoke('cookie');
      expect(repo.revoke).not.toHaveBeenCalled();
    });
  });

  describe('isActive', () => {
    it.each([
      [session(), true],
      [null, false],
      [session({ revokedAt: new Date() }), false],
      [session({ expiresAt: new Date(NOW.getTime() - 1) }), false],
    ])('%#', async (row, expected) => {
      repo.findById.mockResolvedValue(row);
      await expect(service.isActive('s1')).resolves.toBe(expected);
    });
  });
});
