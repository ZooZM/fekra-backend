// Helpers for the feature 003 e2e suites that push DMs and comments through the real inbox.
import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ExpiryService } from '../../src/inbox/expiry.service';
import { PriorityInboxService } from '../../src/inbox/priority-inbox.service';
import { TokenCryptoService } from '../../src/crypto/token-crypto.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { REDIS } from '../../src/redis/redis.constants';
import { hash } from '../../src/auth/consts/auth.contants';
import { PASSWORD } from './e2e-app';

/**
 * A faster pipeline for the suites that push items through the real inbox. Call it at the top of
 * the test file, before createE2eApp(): the settings are read when the app starts and on each
 * dispatch. Not set globally, so the older suites keep their timing.
 */
export function fastPipeline(): void {
  process.env.DISPATCH_INTERVAL_MS = '100';
  process.env.DISPATCH_BATCH = '20';
  process.env.DM_WINDOW_SEC = '1';
  process.env.COMMENT_LLM_MAX_ATTEMPTS = '1';
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Polls until `done(value)` is true. Throws with the last value on timeout (never a fixed sleep). */
export async function waitFor<T>(
  read: () => Promise<T> | T,
  done: (value: T) => boolean,
  timeoutMs = 20_000,
  stepMs = 100,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  let last = await read();
  while (!done(last)) {
    if (Date.now() > end) {
      throw new Error(
        `waitFor timed out after ${timeoutMs} ms, last value: ${JSON.stringify(last)}`,
      );
    }
    await sleep(stepMs);
    last = await read();
  }
  return last;
}

/** The e2e suites own Redis db 15, so it can be emptied. */
export async function flushRedis(app: INestApplication): Promise<void> {
  await app.get<Redis>(REDIS).flushdb();
}

let counter = 0;
export const uniqueId = (prefix: string) =>
  `${prefix}-${Date.now()}-${++counter}`;

/** Sweeps the DM buffers that have expired, so a batch does not wait for the 15 s timer. */
export const sweepDmBuffers = (app: INestApplication): Promise<void> =>
  (app.get(ExpiryService) as unknown as { sweep(): Promise<void> }).sweep();

export async function pushDm(
  app: INestApplication,
  input: {
    accountId: string;
    senderId: string;
    text: string;
    platform?: 'facebook' | 'instagram';
  },
): Promise<boolean> {
  return app.get(PriorityInboxService).push({
    kind: 'message',
    platform: input.platform ?? 'facebook',
    id: uniqueId('mid'),
    accountId: input.accountId,
    senderId: input.senderId,
    text: input.text,
    timestamp: Date.now(),
  });
}

export async function pushComment(
  app: INestApplication,
  input: { accountId: string; text: string; id?: string },
): Promise<boolean> {
  return app.get(PriorityInboxService).push(
    {
      kind: 'comment',
      platform: 'facebook',
      id: input.id ?? uniqueId('comment'),
      accountId: input.accountId,
      senderId: uniqueId('commenter'),
      text: input.text,
      timestamp: Date.now(),
    },
    { skipRateLimit: true },
  );
}

/**
 * A client row with an encrypted access token, like the API creates it. `chat` sets the endpoint
 * and the subscription; by default the client is subscribed with the endpoint `chat-<page id>`.
 */
export async function createChatClient(
  app: INestApplication,
  options: {
    name?: string;
    fbPageId: string;
    endpoint?: string | null;
    subscribed?: boolean;
    commentRepliesOn?: boolean;
  },
) {
  const id = randomUUID();
  const crypto = app.get(TokenCryptoService);
  const endpoint =
    options.endpoint === undefined
      ? `chat-${options.fbPageId}`
      : options.endpoint;
  return app.get(PrismaService).client.create({
    data: {
      id,
      name: options.name ?? `Client ${options.fbPageId}`,
      businessCategory: 'Shop',
      fbPageId: options.fbPageId,
      accessToken: crypto.encrypt('page-token', id),
      chatWorkflowEndpoint: endpoint,
      chatSubscribed: options.subscribed ?? endpoint !== null,
      commentReplyConfig: options.commentRepliesOn
        ? {
            enabled: true,
            likes_enabled: false,
            inquiry_can_dm: [],
            inquiry_can_not_dm: [],
            engagement: [],
          }
        : {},
    },
  });
}

/** A CLIENT-role user that belongs to one client. */
export async function createClientUser(
  prisma: PrismaService,
  email: string,
  clientId: string,
) {
  return prisma.user.create({
    data: {
      name: email.split('@')[0],
      email,
      passwordHash: await hash(PASSWORD),
      roles: ['CLIENT'],
      clientId,
    },
    select: { id: true, email: true },
  });
}
