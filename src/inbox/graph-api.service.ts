// inbox/graph-api.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import { REDIS } from './inbox.constants';
import { ClientRecord } from '@app/clients/types/client.types';
import { BufferedMessage } from './inbox.types';

export type Platform = 'facebook' | 'instagram';

export interface SendableRequest {
  kind: 'comment' | 'batch';
  platform: Platform;
  id: string; // comment id (comments) or batch id
  accountId: string; // Page ID / IG user ID
  senderId?: string;
  clientId: string;
  client?: ClientRecord;
  messages?: BufferedMessage[];
}

const HOSTS: Record<Platform, string> = {
  facebook: 'https://graph.facebook.com/v24.0',
  instagram: 'https://graph.instagram.com/v24.0',
};

// Graph error codes that can succeed later: unknown/temporary and rate limits
const TEMPORARY_CODES = new Set([1, 2, 4, 17, 32, 613]);
const SEND_DEAD = 'send:dead';

interface GraphErrorBody {
  error?: {
    code?: number;
    error_subcode?: number;
    message?: string;
    is_transient?: boolean;
  };
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly temporary: boolean,
    /** Meta's error code and subcode, e.g. 100/33 = object not found, 190 = bad token. */
    readonly code?: number,
    readonly subcode?: number,
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
    await this.send('POST', url, token, body, maxAttempts);
  }

  /** Same retry rules as `post`. Returns the parsed JSON body. */
  async get<T>(url: string, token: string, maxAttempts = 3): Promise<T> {
    const res = await this.send('GET', url, token, undefined, maxAttempts);
    return (await res.json()) as T;
  }

  private async send(
    method: 'GET' | 'POST',
    url: string,
    token: string,
    body: unknown,
    maxAttempts: number,
  ): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      let error: GraphError;
      try {
        const res = await fetch(url, {
          method,
          headers: {
            ...(method === 'POST' && { 'content-type': 'application/json' }),
            authorization: `Bearer ${token}`,
          },
          body: method === 'POST' ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) return res;

        const payload = (await res.json().catch(() => ({}))) as GraphErrorBody;
        const e = payload.error ?? {};
        const temporary =
          res.status >= 500 ||
          res.status === 429 ||
          e.is_transient === true ||
          (e.code !== undefined && TEMPORARY_CODES.has(e.code));
        error = new GraphError(
          `Graph ${res.status} code=${e.code} sub=${e.error_subcode}: ${e.message}`,
          temporary,
          e.code,
          e.error_subcode,
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
