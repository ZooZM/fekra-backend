// inbox/priority-inbox.service.ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { INBOX_KEY, REDIS } from './inbox.constants';
import { InboxItem } from './inbox.types';
import { DmBufferService } from './dm-buffer.service';
import { N8nDeliveryService } from './n8n-delivery.service';
import { ConfigService } from '@nestjs/config';

const RANK = { message: 1, batch: 1, comment: 2 } as const;
const BASE = 1e13; // timestamps in ms are ~1.8e12, so they never cross into the next rank

@Injectable()
export class PriorityInboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriorityInboxService.name);
  private running = false;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly dmBuffer: DmBufferService,
    private readonly delivery: N8nDeliveryService,
    private readonly configService: ConfigService,
  ) {}

  /** Never throws, so callers can use `void inbox.push(...)`. */
  async push(item: InboxItem): Promise<void> {
    const seenKey = `inbox:seen:${item.kind}:${item.platform}:${item.id}`;
    try {
      // Meta redeliveries of the same event are dropped here
      const fresh = await this.redis.set(seenKey, '1', 'EX', 3600, 'NX');
      if (!fresh) return;
      try {
        await this.redis.zadd(
          INBOX_KEY,
          RANK[item.kind] * BASE + item.timestamp,
          JSON.stringify(item),
        );
      } catch (err) {
        await this.redis.del(seenKey).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      this.logger.error(
        `Failed to enqueue ${item.kind} ${item.id}: ${(err as Error).message}`,
      );
    }
  }

  onModuleInit() {
    this.running = true;
    void this.loop();
  }

  onModuleDestroy() {
    this.running = false;
  }

  private async loop() {
    const interval =
      this.configService.get<number>('DISPATCH_INTERVAL_MS') ?? 1000;
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(`Dispatch tick failed: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  private async tick() {
    const max = this.configService.get<number>('DISPATCH_BATCH') ?? 5;
    // ZPOPMIN is atomic, so several instances never take the same item
    const popped = await this.redis.zpopmin(INBOX_KEY, max); // [member, score, member, score...]

    for (let i = 0; i < popped.length; i += 2) {
      const item = JSON.parse(popped[i]) as InboxItem;
      try {
        await this.handle(item);
      } catch (err) {
        this.logger.error(
          `Failed to handle ${item.kind} ${item.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async handle(item: InboxItem) {
    switch (item.kind) {
      case 'message':
        await this.dmBuffer.add(item); // cheap Redis write, restarts the 10s timer
        break;
      case 'comment':
        await this.delivery.send(`${item.platform}-comment-${item.id}`, item);
        break;
      case 'batch':
        // const clientData = await clientDataService.get(item.senderId); // optional, from the earlier step
        await this.delivery.send(item.id, item);
        break;
    }
  }
}
