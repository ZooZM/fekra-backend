// redis/redis.module.ts
import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS } from './redis.constants';

export const redisOptions = (config: ConfigService) => ({
  host: config.get<string>('REDIS_HOST') ?? '127.0.0.1',
  port: Number(config.get('REDIS_PORT') ?? 6379),
  password: config.get<string>('REDIS_PASSWORD') || undefined,
  db: Number(config.get('REDIS_DB') ?? 0),
});

/** The shared Redis connection (inbox queues, sign-in throttling, health check). */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => new Redis(redisOptions(config)),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit().catch(() => undefined);
  }
}
