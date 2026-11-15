import { Logger } from '@nestjs/common';
import { ChatPauseSweeper } from './chat-pause.sweeper';

describe('ChatPauseSweeper', () => {
  let conversations: { releaseExpiredPauses: jest.Mock };
  let config: { get: jest.Mock };
  let sweeper: ChatPauseSweeper;

  beforeEach(() => {
    jest.useFakeTimers();
    conversations = { releaseExpiredPauses: jest.fn().mockResolvedValue(0) };
    config = { get: jest.fn() };
    sweeper = new ChatPauseSweeper(conversations as never, config as never);
  });
  afterEach(() => {
    sweeper.onModuleDestroy();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('sweeps on the interval from PAUSE_SWEEP_INTERVAL_MS', async () => {
    config.get.mockReturnValue('5000');
    sweeper.onModuleInit();

    await jest.advanceTimersByTimeAsync(4999);
    expect(conversations.releaseExpiredPauses).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(conversations.releaseExpiredPauses).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(5000);
    expect(conversations.releaseExpiredPauses).toHaveBeenCalledTimes(2);
  });

  it('defaults to 30 seconds when the variable is missing or invalid', async () => {
    config.get.mockReturnValue('nope');
    sweeper.onModuleInit();
    await jest.advanceTimersByTimeAsync(29_999);
    expect(conversations.releaseExpiredPauses).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(conversations.releaseExpiredPauses).toHaveBeenCalledTimes(1);
  });

  it('logs an error and keeps running after a failed sweep', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    config.get.mockReturnValue('1000');
    conversations.releaseExpiredPauses
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue(0);
    sweeper.onModuleInit();

    await jest.advanceTimersByTimeAsync(1000);
    expect(error).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(conversations.releaseExpiredPauses).toHaveBeenCalledTimes(2);
  });

  it('stops sweeping after onModuleDestroy', async () => {
    config.get.mockReturnValue('1000');
    sweeper.onModuleInit();
    sweeper.onModuleDestroy();
    await jest.advanceTimersByTimeAsync(5000);
    expect(conversations.releaseExpiredPauses).not.toHaveBeenCalled();
  });
});
