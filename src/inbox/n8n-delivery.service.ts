// inbox/n8n-delivery.service.ts
import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import { DEAD_LIST, PENDING_HASH, REDIS, REQ_TTL } from './inbox.constants';
import { ConfigService } from '@nestjs/config';
import { ClientsService } from '@app/clients/clients.service';
import { buildWorkflowUrl, parseBaseUrl } from './chat-workflow-url';

interface Pending {
  payload: unknown;
  attempts: number;
}

/** Why a delivery ended without reaching a workflow: the item goes to the dead list for operators. */
export type DeadReason =
  'MAX_ATTEMPTS' | 'UNSUBSCRIBED' | 'NO_ENDPOINT' | 'NO_BASE_URL';

@Injectable()
export class N8nDeliveryService {
  private readonly logger = new Logger(N8nDeliveryService.name);
  private readonly baseUrl: URL | null;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ClientsService))
    private readonly clients: ClientsService,
  ) {
    // A malformed base address fails at boot. A missing one fails at boot only in production, so
    // a developer without n8n can still run the app (the delivery then dead-letters, see post).
    const configured = this.configService.get<string>('N8N_BASE_URL');
    if (configured) {
      this.baseUrl = parseBaseUrl(configured);
    } else if (this.configService.get<string>('NODE_ENV') === 'production') {
      throw new Error('N8N_BASE_URL is required in production');
    } else {
      this.baseUrl = null;
      this.logger.warn(
        'N8N_BASE_URL is not set: chat messages cannot be delivered to a workflow',
      );
    }
  }

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

  /**
   * One delivery attempt. The client's route is read fresh on every attempt, resends included, so
   * an unsubscribe or an endpoint change applies to the very next attempt (FR-046, research R2).
   */
  private async post(id: string, payload: unknown, attempt: number) {
    try {
      const clientId = (payload as { client?: { id?: string } }).client?.id;
      const route = clientId
        ? await this.clients.findChatRouteById(clientId)
        : null;

      if (!route?.chatSubscribed) {
        return await this.deadLetter(id, 'UNSUBSCRIBED', attempt);
      }
      if (!route.chatWorkflowEndpoint) {
        return await this.deadLetter(id, 'NO_ENDPOINT', attempt);
      }
      if (!this.baseUrl) {
        return await this.deadLetter(id, 'NO_BASE_URL', attempt);
      }

      const url = buildWorkflowUrl(this.baseUrl, route.chatWorkflowEndpoint);
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
      // No retry here: the TTL expiry resends it (a database error on the route read lands here too)
      this.logger.warn(
        `Post to n8n failed for ${id}: ${(err as Error).message}`,
      );
    }
  }

  /** Terminal state: out of the pending set, into the dead list with the reason. */
  private async deadLetter(id: string, reason: DeadReason, attempts: number) {
    const taken = await this.take(id);
    if (!taken) return; // already acked or expired: someone else owns it now
    this.logger.warn(`Not delivering ${id}: ${reason}`);
    await this.redis.lpush(
      DEAD_LIST,
      JSON.stringify({ id, payload: taken.payload, attempts, reason }),
    );
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
        JSON.stringify({ id, payload, attempts, reason: 'MAX_ATTEMPTS' }),
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
