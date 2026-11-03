// inbox/n8n-delivery.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DEAD_LIST, PENDING_HASH, REDIS, REQ_TTL } from './inbox.constants';
import { ConfigService } from '@nestjs/config';

interface Pending {
  payload: unknown;
  attempts: number;
}

@Injectable()
export class N8nDeliveryService {
  private readonly logger = new Logger(N8nDeliveryService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  /** Register in Redis, then fire the request without waiting for the workflow. */
  async send(id: string, payload: unknown, attempts = 1): Promise<void> {
    const ttl = this.configService.get<number>('N8N_ACK_TTL_SEC') ?? 90;

    // Registered BEFORE posting, so a crash right after can't lose the request
    await this.redis
      .multi()
      .hset(
        PENDING_HASH,
        id,
        JSON.stringify({ payload, attempts } satisfies Pending),
      )
      .set(`${REQ_TTL}${id}`, '1', 'EX', ttl)
      .exec();

    void this.post(id, payload, attempts);
  }

  private async post(id: string, payload: unknown, attempt: number) {
    const url = this.configService.get<string>('N8N_WEBHOOK_URL');
    if (!url) return this.logger.error('N8N_WEBHOOK_URL is not configured');

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-webhook-secret':
            this.configService.get<string>('N8N_WEBHOOK_SECRET') ?? '',
        },
        body: JSON.stringify({
          requestId: id,
          attempt,
          ...(payload as object),
        }),
        signal: AbortSignal.timeout(5000), // handoff only, never the LLM
      });
      if (!res.ok) this.logger.warn(`n8n responded ${res.status} for ${id}`);
    } catch (err) {
      // No retry here: the TTL expiry resends it
      this.logger.warn(
        `Post to n8n failed for ${id}: ${(err as Error).message}`,
      );
    }
  }

  /** n8n called back. True if the id was still pending. */
  async ack(id: string): Promise<boolean> {
    const res = await this.redis
      .multi()
      .del(`${REQ_TTL}${id}`)
      .hdel(PENDING_HASH, id)
      .exec();
    return res?.[1]?.[1] === 1;
  }

  /** TTL ran out without an ack. Safe to call twice: only one caller wins the claim. */
  async onExpire(id: string): Promise<void> {
    const res = await this.redis
      .multi()
      .hget(PENDING_HASH, id)
      .hdel(PENDING_HASH, id)
      .exec();
    const raw = res?.[0]?.[1] as string | null;
    if (!raw || res?.[1]?.[1] !== 1) return;

    const { payload, attempts } = JSON.parse(raw) as Pending;
    const max = this.configService.get<number>('N8N_MAX_ATTEMPTS') ?? 3;

    if (attempts >= max) {
      this.logger.error(`Giving up on ${id} after ${attempts} attempts`);
      await this.redis.lpush(
        DEAD_LIST,
        JSON.stringify({ id, payload, attempts }),
      );
      return;
    }
    this.logger.warn(
      `No ack for ${id}, resending (attempt ${attempts + 1}/${max})`,
    );
    await this.send(id, payload, attempts + 1);
  }

  async take(id: string): Promise<{ payload: any; attempts: number } | null> {
    const res = await this.redis
      .multi()
      .hget(PENDING_HASH, id)
      .hdel(PENDING_HASH, id)
      .del(`${REQ_TTL}${id}`)
      .exec();

    const raw = res?.[0]?.[1] as string | null;
    if (!raw || res?.[1]?.[1] !== 1) return null; // already acked, expired, or unknown
    return JSON.parse(raw);
  }
}
