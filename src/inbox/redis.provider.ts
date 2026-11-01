// inbox/redis.provider.ts
import { Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS, REDIS_SUB } from './inbox.constants';

const options = () => ({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB ?? 0),
});

export const redisProviders: Provider[] = [
  { provide: REDIS, useFactory: () => new Redis(options()) },
  // a connection in subscribe mode can't run normal commands, so it gets its own
  { provide: REDIS_SUB, useFactory: () => new Redis(options()) },
];
