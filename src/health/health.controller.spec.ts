import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let prisma: { $queryRaw: jest.Mock };
  let redis: { ping: jest.Mock };
  let controller: HealthController;

  beforeEach(() => {
    prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    redis = { ping: jest.fn().mockResolvedValue('PONG') };
    controller = new HealthController(prisma as never, redis as never);
  });

  it('returns ok when PostgreSQL and Redis answer', async () => {
    await expect(controller.check()).resolves.toEqual({ status: 'ok' });
  });

  it('returns 503 without details when PostgreSQL is down', async () => {
    prisma.$queryRaw.mockRejectedValue(
      new Error('connect ECONNREFUSED db:5432'),
    );
    const err = await controller.check().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    const response = (err as ServiceUnavailableException).getResponse();
    expect(JSON.stringify(response)).not.toContain('ECONNREFUSED');
    expect(response).toMatchObject({
      errorCode: 'DEPENDENCY_UNAVAILABLE',
    });
  });

  it('returns 503 when Redis is down', async () => {
    redis.ping.mockRejectedValue(new Error('Redis down'));
    await expect(controller.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
