import { Platform, Prisma } from '@app/generated/prisma/client';

/** How long an administrator pauses the assistant in one conversation (FR-009). */
export type PauseDuration = 'until_resumed' | '1h' | '24h' | '7d';

/** Milliseconds per duration. `null` = until an administrator resumes it. */
export const PAUSE_DURATION_MS: Record<PauseDuration, number | null> = {
  until_resumed: null,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

/** The administrator behind a pause or resume, copied into the chat and its events. */
export interface PauseActor {
  id: string;
  name: string;
}

export type ChatRowWithClient = Prisma.ChatGetPayload<{
  include: { client: { select: { id: true; name: true } } };
}>;

/** The newest exchange of a conversation; message and reply are cut to 200 characters. */
export interface LastExchange {
  message: string;
  reply: string;
  answered: boolean;
  createdAt: Date;
}

/** One exchange as an n8n chat workflow reads it (feature 004): full texts, no ids. */
export interface ExchangeSummary {
  message: string;
  /** "" when answered is false */
  reply: string;
  answered: boolean;
  createdAt: Date;
}

/** Which conversation to read the latest exchanges of: one client's, with one customer. */
export interface RecentExchangesQuery {
  clientId: string;
  platform: Platform;
  /** The client's account (Page ID / Instagram account ID). */
  receiverId: string;
  /** The customer (PSID / IGSID). */
  senderId: string;
  limit: number;
}

/** What the API returns for a conversation (data-model §8). */
export interface ChatRecord {
  id: string;
  clientId: string;
  clientName: string;
  platform: ChatRowWithClient['platform'];
  senderId: string;
  receiverId: string;
  createdAt: Date;
  updatedAt: Date;
  /** Effective state now: a timed pause that has ended is not paused. */
  paused: boolean;
  pausedAt: Date | null;
  pausedUntil: Date | null;
  /** ADMIN readers only; always null for CLIENT-role readers. */
  pausedBy: { id: string; name: string } | null;
  lastExchange: LastExchange | null;
}
