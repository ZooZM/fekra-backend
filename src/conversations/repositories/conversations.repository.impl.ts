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
  QueryMessageReplyInput,
} from '../schemas/message-reply.schema';
import { IConversationsRepository } from './IConversationsRepository.repository';

@Injectable()
export class ConversationsRepository implements IConversationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryChatInput,
    clientId?: string,
  ): Promise<PaginatedResult<Chat>> {
    const where: Prisma.ChatWhereInput = {
      ...(clientId && { clientId }),
      ...(query.platform && { platform: query.platform }),
      ...(query.senderId && { senderId: query.senderId }),
      ...(query.receiverId && { receiverId: query.receiverId }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.chat.findMany({
        where,
        orderBy: [{ [query.orderBy]: query.orderDir }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.chat.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  findById(chatId: string, clientId?: string): Promise<Chat | null> {
    return this.prisma.chat.findFirst({
      where: { id: chatId, ...(clientId && { clientId }) },
    });
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
}
