// inbox/dm-buffer.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DM_DATA, DM_TTL, REDIS } from './inbox.constants';
import { BufferedMessage, InboxItem, Platform } from './inbox.types';
import { ConfigService } from '@nestjs/config';

type MessageItem = Extract<InboxItem, { kind: 'message' }>;
type BatchItem = Extract<InboxItem, { kind: 'batch' }>;

@Injectable()
export class DmBufferService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  /**
   * One hash per sender (field = mid, value = message). HSET is atomic, so two
   * instances adding at once can't overwrite each other like a JSON array would.
   * SET ... EX restarts the timer on every message.
   */
  async add(
    item: MessageItem,
    text: string,
    field = item.id, // hash field, must be unique per buffered piece
    timestamp = item.timestamp, // keeps pieces of one message in order
  ): Promise<void> {
    const key = `${item.platform}:${item.accountId}:${item.senderId}`;
    const ttl = this.configService.get<number>('DM_WINDOW_SEC') ?? 10;

    await this.redis
      .multi()
      .hset(`${DM_DATA}${key}`, field, JSON.stringify({ text, timestamp }))
      .set(`${DM_TTL}${key}`, '1', 'EX', ttl)
      .exec();
  }

  /** Atomically takes the whole buffer. Returns null if someone else already did. */
  async collect(key: string): Promise<BatchItem | null> {
    const dataKey = `${DM_DATA}${key}`;
    const res = await this.redis.multi().hgetall(dataKey).del(dataKey).exec();
    const entries = (res?.[0]?.[1] as Record<string, string>) ?? {};

    const messages: BufferedMessage[] = Object.entries(entries)
      .map(([mid, v]) => ({ mid, ...JSON.parse(v) }) as BufferedMessage)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (messages.length === 0) return null;

    const [platform, accountId, senderId] = key.split(':');
    return {
      kind: 'batch',
      id: `dm-${key}-${messages[0].mid}`,
      platform: platform as Platform,
      accountId,
      senderId,
      timestamp: messages[0].timestamp, // oldest message decides the priority
      messages,
    };
  }
}
