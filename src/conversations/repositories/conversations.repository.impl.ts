import { Injectable } from '@nestjs/common';
import { Chat, MessageReply, Prisma } from '@app/generated/prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  PaginatedResult,
  paginate,
} from '@app/common/helpers/pagination.helper';
import { FindOrCreateChatInput, QueryChatInput } from '../schemas/chat.schema';
import {
  CreateMessageReplyInput,
  CreateUnansweredMessageInput,
  QueryMessageReplyInput,
} from '../schemas/message-reply.schema';
import {
  ChatRowWithClient,
  LastExchange,
  PauseActor,
  PauseDuration,
} from '../types/chat.types';
import { IConversationsRepository } from './IConversationsRepository.repository';

const WITH_CLIENT = {
  client: { select: { id: true, name: true } },
} as const;

interface LastExchangeRow {
  chat_id: string;
  message: string;
  reply: string;
  answered: boolean;
  created_at: Date;
}

@Injectable()
export class ConversationsRepository implements IConversationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryChatInput,
    clientId?: string,
  ): Promise<PaginatedResult<ChatRowWithClient>> {
    const where: Prisma.ChatWhereInput = {
      ...(clientId && { clientId }),
      ...(query.platform && { platform: query.platform }),
      ...(query.senderId && { senderId: query.senderId }),
      ...(query.receiverId && { receiverId: query.receiverId }),
      ...(query.paused !== undefined && this.pausedFilter(query.paused)),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chat.findMany({
        where,
        include: WITH_CLIENT,
        orderBy: [{ [query.orderBy]: query.orderDir }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.chat.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  /** The same rule as isEffectivelyPaused, as a where clause. */
  private pausedFilter(paused: boolean): Prisma.ChatWhereInput {
    const now = new Date();
    const pausedNow: Prisma.ChatWhereInput = {
      pausedAt: { not: null },
      OR: [{ pausedUntil: null }, { pausedUntil: { gt: now } }],
    };
    return paused ? pausedNow : { NOT: pausedNow };
  }

  findById(
    chatId: string,
    clientId?: string,
  ): Promise<ChatRowWithClient | null> {
    return this.prisma.chat.findFirst({
      where: { id: chatId, ...(clientId && { clientId }) },
      include: WITH_CLIENT,
    });
  }

  async lastExchanges(chatIds: string[]): Promise<Map<string, LastExchange>> {
    const result = new Map<string, LastExchange>();
    if (chatIds.length === 0) return result;

    // One query for the whole page (research R7). It uses the (chat_id, created_at) index.
    const rows = await this.prisma.$queryRaw<LastExchangeRow[]>`
      SELECT DISTINCT ON (chat_id)
        chat_id, left(message, 200) AS message, left(reply, 200) AS reply, answered, created_at
      FROM message_replies
      WHERE chat_id = ANY(${chatIds}::uuid[])
      ORDER BY chat_id, created_at DESC, id DESC`;
    for (const row of rows) {
      result.set(row.chat_id, {
        message: row.message,
        reply: row.reply,
        answered: row.answered,
        createdAt: row.created_at,
      });
    }
    return result;
  }

  async findMessages(
    chatId: string,
    query: QueryMessageReplyInput,
  ): Promise<PaginatedResult<MessageReply>> {
    const where: Prisma.MessageReplyWhereInput = {
      chatId,
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from && { gte: query.from }),
              ...(query.to && { lte: query.to }),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.messageReply.findMany({
        where,
        orderBy: [{ [query.orderBy]: query.orderDir }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.messageReply.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  findOrCreate(data: FindOrCreateChatInput): Promise<Chat> {
    return this.prisma.chat.upsert({
      where: {
        platform_receiverId_senderId: {
          platform: data.platform,
          receiverId: data.receiverId,
          senderId: data.senderId,
        },
      },
      create: data,
      update: { clientId: data.clientId, updatedAt: new Date() },
    });
  }

  createMessage(data: CreateMessageReplyInput): Promise<MessageReply> {
    return this.prisma.messageReply.create({ data });
  }

  createUnansweredMessage(
    data: CreateUnansweredMessageInput,
  ): Promise<MessageReply> {
    return this.prisma.messageReply.create({
      data: {
        chatId: data.chatId,
        message: data.message,
        reply: '',
        answered: false,
      },
    });
  }

  pause(
    chatId: string,
    until: Date | null,
    duration: PauseDuration,
    actor: PauseActor,
  ): Promise<ChatRowWithClient> {
    return this.prisma.$transaction(async (tx) => {
      const chat = await tx.chat.update({
        where: { id: chatId },
        data: {
          pausedAt: new Date(),
          pausedUntil: until,
          pausedById: actor.id,
          pausedByName: actor.name,
        },
        include: WITH_CLIENT,
      });
      await tx.chatPauseEvent.create({
        data: {
          chatId,
          action: 'PAUSED',
          duration,
          until,
          actorId: actor.id,
          actorName: actor.name,
        },
      });
      return chat;
    });
  }

  resume(chatId: string, actor: PauseActor): Promise<ChatRowWithClient> {
    return this.prisma.$transaction(async (tx) => {
      const chat = await tx.chat.update({
        where: { id: chatId },
        data: {
          pausedAt: null,
          pausedUntil: null,
          pausedById: null,
          pausedByName: null,
        },
        include: WITH_CLIENT,
      });
      await tx.chatPauseEvent.create({
        data: {
          chatId,
          action: 'RESUMED',
          actorId: actor.id,
          actorName: actor.name,
        },
      });
      return chat;
    });
  }

  async purgeBefore(
    cutoff: Date,
    batch = 5000,
  ): Promise<{ chats: number; exchanges: number }> {
    // Each pass deletes at most `batch` rows, so a big backlog never holds a long lock on tables
    // the DM path writes to. The foreign keys cascade to exchanges and pause events.
    let chats = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM chats WHERE id IN (
          SELECT id FROM chats WHERE updated_at < ${cutoff} LIMIT ${batch})`;
      chats += deleted;
      if (deleted < batch) break;
    }
    let exchanges = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM message_replies WHERE id IN (
          SELECT id FROM message_replies WHERE created_at < ${cutoff} LIMIT ${batch})`;
      exchanges += deleted;
      if (deleted < batch) break;
    }
    return { chats, exchanges };
  }

  releaseExpiredPauses(now: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      // RETURNING gives the row as it is after the update, where paused_until is already NULL, so
      // the expiry time is read first, in a CTE that locks the rows. SKIP LOCKED makes two instances
      // claim different rows: each expiry is recorded once.
      const released = await tx.$queryRaw<{ id: string; paused_until: Date }[]>`
        WITH due AS (
          SELECT id, paused_until FROM chats
          WHERE paused_until IS NOT NULL AND paused_until <= ${now}
          FOR UPDATE SKIP LOCKED
        )
        UPDATE chats c
        SET paused_at = NULL, paused_until = NULL, paused_by_id = NULL, paused_by_name = NULL
        FROM due
        WHERE c.id = due.id
        RETURNING c.id, due.paused_until`;
      if (released.length > 0) {
        await tx.chatPauseEvent.createMany({
          data: released.map((row) => ({
            chatId: row.id,
            action: 'RESUMED' as const,
            createdAt: row.paused_until,
          })),
        });
      }
      return released.length;
    });
  }
}
