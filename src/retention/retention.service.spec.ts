import { Logger } from '@nestjs/common';
import { RetentionService } from './retention.service';

describe('RetentionService', () => {
  let conversations: { purgeBefore: jest.Mock };
  let comments: { purgeBefore: jest.Mock };
  let leads: { purgeBefore: jest.Mock };
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  const build = (months?: string | number) =>
    new RetentionService(
      { get: () => months } as never,
      conversations as never,
      comments as never,
      leads as never,
    );

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-14T12:00:00.000Z'));
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    conversations = {
      purgeBefore: jest.fn().mockResolvedValue({ chats: 2, exchanges: 5 }),
    };
    comments = { purgeBefore: jest.fn().mockResolvedValue(7) };
    leads = { purgeBefore: jest.fn().mockResolvedValue(3) };
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('configuration', () => {
    it('defaults to 12 months when the variable is missing or empty', () => {
      const cutoff = build(undefined).cutoff(new Date('2026-11-14T12:00:00Z'));
      expect(cutoff.toISOString()).toBe('2025-11-14T12:00:00.000Z');
      expect(build('  ').cutoff(new Date('2026-11-14T12:00:00Z'))).toEqual(
        cutoff,
      );
    });

    it.each(['0', '-1', 'abc', '1.5', 0, -3])(
      'fails at boot for RETENTION_MONTHS=%p',
      (value) => {
        expect(() => build(value)).toThrow(/at least 1/);
      },
    );

    it('accepts a number or a numeric string', () => {
      expect(() => build(6)).not.toThrow();
      expect(() => build('24')).not.toThrow();
    });
  });

  describe('cutoff', () => {
    it('subtracts calendar months in UTC', () => {
      expect(
        build(11).cutoff(new Date('2026-11-14T00:00:00Z')).toISOString(),
      ).toBe('2025-12-14T00:00:00.000Z');
      expect(
        build(13).cutoff(new Date('2026-11-14T08:30:00Z')).toISOString(),
      ).toBe('2025-10-14T08:30:00.000Z');
    });

    it('clamps to the last day of a shorter month (31 March minus 1 month)', () => {
      expect(
        build(1).cutoff(new Date('2026-03-31T10:00:00Z')).toISOString(),
      ).toBe('2026-02-28T10:00:00.000Z');
      expect(
        build(1).cutoff(new Date('2028-03-31T10:00:00Z')).toISOString(),
      ).toBe('2028-02-29T10:00:00.000Z');
    });

    it('crosses a year boundary', () => {
      expect(
        build(2).cutoff(new Date('2026-01-15T00:00:00Z')).toISOString(),
      ).toBe('2025-11-15T00:00:00.000Z');
    });
  });

  describe('a run', () => {
    it('deletes through the three services with the same cutoff', async () => {
      await build(12).runOnce(new Date('2026-11-14T12:00:00.000Z'));

      const cutoff = new Date('2025-11-14T12:00:00.000Z');
      expect(conversations.purgeBefore).toHaveBeenCalledWith(cutoff);
      expect(comments.purgeBefore).toHaveBeenCalledWith(cutoff);
      expect(leads.purgeBefore).toHaveBeenCalledWith(cutoff);
    });

    it('logs the four counts and no text', async () => {
      await build(12).runOnce();
      expect(log).toHaveBeenCalledWith(
        'Retention run: deleted 2 conversations, 5 exchanges, 7 comments and 3 leads older than 12 months',
      );
    });

    it('logs an error and does not throw when a run fails', async () => {
      conversations.purgeBefore.mockRejectedValue(new Error('db down'));
      await expect(build(12).runOnce()).resolves.toBeUndefined();
      expect(error).toHaveBeenCalledWith(
        expect.stringContaining('Retention run failed: db down'),
        expect.any(String),
      );
      expect(comments.purgeBefore).not.toHaveBeenCalled();
      expect(leads.purgeBefore).not.toHaveBeenCalled();
    });
  });

  describe('schedule', () => {
    it('runs 1 minute after boot, then every 24 hours', async () => {
      const service = build(12);
      service.onModuleInit();

      await jest.advanceTimersByTimeAsync(59_999);
      expect(conversations.purgeBefore).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1);
      expect(conversations.purgeBefore).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(
        conversations.purgeBefore.mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
      service.onModuleDestroy();
    });

    it('keeps running after a failed run', async () => {
      conversations.purgeBefore
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValue({ chats: 0, exchanges: 0 });
      const service = build(12);
      service.onModuleInit();

      await jest.advanceTimersByTimeAsync(60_000);
      await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

      expect(
        conversations.purgeBefore.mock.calls.length,
      ).toBeGreaterThanOrEqual(2);
      service.onModuleDestroy();
    });

    it('stops both timers on shutdown', async () => {
      const service = build(12);
      service.onModuleInit();
      service.onModuleDestroy();
      await jest.advanceTimersByTimeAsync(3 * 24 * 60 * 60 * 1000);
      expect(conversations.purgeBefore).not.toHaveBeenCalled();
    });
  });
});
