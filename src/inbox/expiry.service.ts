// inbox/expiry.service.ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  DM_DATA,
  DM_TTL,
  PENDING_HASH,
  REDIS,
  REDIS_SUB,
  REQ_TTL,
} from './inbox.constants';
import { PriorityInboxService } from './priority-inbox.service';
import { DmBufferService } from './dm-buffer.service';
import { N8nDeliveryService } from './n8n-delivery.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ExpiryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpiryService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(REDIS_SUB) private readonly sub: Redis,
    private readonly inbox: PriorityInboxService,
    private readonly dmBuffer: DmBufferService,
    private readonly delivery: N8nDeliveryService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      await this.redis.config('SET', 'notify-keyspace-events', 'Ex');
    } catch {
      this.logger.warn(
        'Could not enable keyspace notifications; the sweeper will handle expiries',
      );
    }

    const db = this.configService.get<number>('REDIS_DB') ?? 0;
    await this.sub.subscribe(`__keyevent@${db}__:expired`);
    this.sub.on('message', (_channel, key) => void this.handleExpired(key));

    // Safety net: notifications are fire-and-forget, so anything missed (app down,
    // dropped connection) is picked up here
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), 15_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async handleExpired(key: string) {
    try {
      if (key.startsWith(DM_TTL)) await this.flushDm(key.slice(DM_TTL.length));
      else if (key.startsWith(REQ_TTL))
        await this.delivery.onExpire(key.slice(REQ_TTL.length));
    } catch (err) {
      this.logger.error(
        `Expiry handling failed for ${key}: ${(err as Error).message}`,
      );
    }
  }

  private async flushDm(key: string) {
    const batch = await this.dmBuffer.collect(key);
    if (batch) await this.inbox.push(batch); // back through the priority queue
  }

  private async sweep() {
    try {
      for (const id of await this.redis.hkeys(PENDING_HASH)) {
        if (!(await this.redis.exists(`${REQ_TTL}${id}`)))
          await this.delivery.onExpire(id);
      }

      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          `${DM_DATA}*`,
          'COUNT',
          100,
        );
        cursor = next;
        for (const k of keys) {
          const key = k.slice(DM_DATA.length);
          if (!(await this.redis.exists(`${DM_TTL}${key}`)))
            await this.flushDm(key);
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.error(`Sweep failed: ${(err as Error).message}`);
    }
  }
}
