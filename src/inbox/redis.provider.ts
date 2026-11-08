// inbox/redis.provider.ts
import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { redisOptions } from '@app/redis/redis.module';
import { REDIS_SUB } from './inbox.constants';

// The main REDIS connection now comes from the global RedisModule.
export const redisProviders: Provider[] = [
  // a connection in subscribe mode can't run normal commands, so it gets its own
  {
    provide: REDIS_SUB,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => new Redis(redisOptions(config)),
  },
];
