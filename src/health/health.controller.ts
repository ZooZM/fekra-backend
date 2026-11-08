// health/health.controller.ts
import {
  Controller,
  Get,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PrismaService } from '@app/prisma/prisma.service';
import { REDIS } from '@app/redis/redis.constants';

/** Unauthenticated. 200 only when PostgreSQL and Redis answer; the deployment gate. */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.redis.ping();
      return { status: 'ok' };
    } catch (err) {
      this.logger.error(`Health check failed: ${(err as Error).message}`);
      // no details in the body: nothing about our infrastructure leaks
      throw new ServiceUnavailableException({
        message: 'Service unavailable',
        errorCode: 'DEPENDENCY_UNAVAILABLE',
      });
    }
  }
}
