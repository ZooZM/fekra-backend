// inbox/graph-api.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from './inbox.constants';

export type Platform = 'facebook' | 'instagram';

export interface SendableRequest {
  kind: 'comment' | 'batch';
  platform: Platform;
  id: string; // comment id (comments) or batch id
  accountId: string; // Page ID / IG user ID
  senderId?: string;
  client: { id: string };
}

const HOSTS: Record<Platform, string> = {
  facebook: 'https://graph.facebook.com/v24.0',
  instagram: 'https://graph.instagram.com/v24.0',
};

// Graph error codes that can succeed later: unknown/temporary and rate limits
const TEMPORARY_CODES = new Set([1, 2, 4, 17, 32, 613]);
const SEND_DEAD = 'send:dead';

export class GraphError extends Error {
  constructor(
    message: string,
    readonly temporary: boolean,
  ) {
    super(message);
  }
}

@Injectable()
export class GraphApiService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  host(platform: Platform): string {
    return HOSTS[platform];
  }

  /** Retries temporary failures (5xx, 429, network, transient codes). Throws GraphError otherwise. */
  async post(
    url: string,
    body: unknown,
    token: string,
    maxAttempts = 3,
  ): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      let error: GraphError;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return;

        const e = ((await res.json().catch(() => ({}))) as any).error ?? {};
        const temporary =
          res.status >= 500 ||
          res.status === 429 ||
          e.is_transient === true ||
          TEMPORARY_CODES.has(e.code);
        error = new GraphError(
          `Graph ${res.status} code=${e.code} sub=${e.error_subcode}: ${e.message}`,
          temporary,
        );
      } catch (err) {
        error = new GraphError(
          `Network error: ${(err as Error).message}`,
          true,
        );
      }

      if (!error.temporary || attempt >= maxAttempts) throw error;
      await new Promise((r) => setTimeout(r, 2000 * attempt)); // 2s, 4s
    }
  }

  /** Keeps what's needed to retry by hand. Never stores the token. */
  async deadLetter(entry: Record<string, unknown>): Promise<void> {
    await this.redis
      .lpush(SEND_DEAD, JSON.stringify({ at: Date.now(), ...entry }))
      .catch(() => undefined);
    await this.redis.ltrim(SEND_DEAD, 0, 99).catch(() => undefined);
  }
}
