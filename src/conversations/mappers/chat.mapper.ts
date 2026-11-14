import { Chat } from '@app/generated/prisma/client';
import {
  ChatRecord,
  ChatRowWithClient,
  LastExchange,
} from '../types/chat.types';

/**
 * A chat is paused when it has a pause and the pause has not ended. This is computed on every
 * read and never trusted from a flag, so a timed pause ends exactly on time (research R5).
 */
export function isEffectivelyPaused(
  chat: Pick<Chat, 'pausedAt' | 'pausedUntil'>,
  now: Date = new Date(),
): boolean {
  if (!chat.pausedAt) return false;
  return chat.pausedUntil === null || chat.pausedUntil > now;
}

export function toChatRecord(
  row: ChatRowWithClient,
  lastExchange: LastExchange | null,
  options: { isAdmin: boolean; now?: Date },
): ChatRecord {
  const paused = isEffectivelyPaused(row, options.now);
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    platform: row.platform,
    senderId: row.senderId,
    receiverId: row.receiverId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    paused,
    pausedAt: paused ? row.pausedAt : null,
    pausedUntil: paused ? row.pausedUntil : null,
    pausedBy:
      paused && options.isAdmin && row.pausedById && row.pausedByName
        ? { id: row.pausedById, name: row.pausedByName }
        : null,
    lastExchange,
  };
}
