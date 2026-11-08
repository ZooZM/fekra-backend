// auth/login-throttle.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { createHash } from 'node:crypto';
import { REDIS } from '@app/redis/redis.constants';
import {
  DEFAULT_LOGIN_BLOCK_MINUTES,
  DEFAULT_LOGIN_MAX_FAILURES,
  LOGIN_FAIL_KEY_PREFIX,
} from './consts/session.constants';

/**
 * Blocks sign-in for an email after too many failures. The Redis key holds only a hash of
 * the email. The block ends when the key expires.
 */
@Injectable()
export class LoginThrottleService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  private get max(): number {
    const n = Number(this.config.get('LOGIN_MAX_FAILURES'));
    return n > 0 ? n : DEFAULT_LOGIN_MAX_FAILURES;
  }

  private get windowSeconds(): number {
    const m = Number(this.config.get('LOGIN_BLOCK_MINUTES'));
    return (m > 0 ? m : DEFAULT_LOGIN_BLOCK_MINUTES) * 60;
  }

  private key(email: string): string {
    const digest = createHash('sha256')
      .update(email.trim().toLowerCase())
      .digest('hex');
    return `${LOGIN_FAIL_KEY_PREFIX}${digest}`;
  }

  async isBlocked(email: string): Promise<boolean> {
    const count = Number(await this.redis.get(this.key(email)));
    return count >= this.max;
  }

  async recordFailure(email: string): Promise<void> {
    const key = this.key(email);
    const count = await this.redis.incr(key);
    // the window starts at the first failure; reaching the limit restarts it, so the
    // block lasts the full period from the failure that triggered it
    if (count === 1 || count === this.max) {
      await this.redis.expire(key, this.windowSeconds);
    }
  }

  async reset(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }
}
