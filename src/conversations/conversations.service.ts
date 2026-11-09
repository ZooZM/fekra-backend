import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '@app/users/types/safe-user.type';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { FindOrCreateChatSchema, QueryChatInput } from './schemas/chat.schema';
import {
  CreateMessageReplyInput,
  CreateMessageReplySchema,
  QueryMessageReplyInput,
} from './schemas/message-reply.schema';
import { Chat, MessageReply } from '@app/generated/prisma/client';
import {
  CONVERSATIONS_REPOSITORY,
  IConversationsRepository,
} from './repositories/IConversationsRepository.repository';

@Injectable()
export class ConversationsService {
  constructor(
    @Inject(CONVERSATIONS_REPOSITORY)
    private readonly repo: IConversationsRepository,
  ) {}

  findAll(
    query: QueryChatInput,
    user: SafeUser,
  ): Promise<PaginatedResult<Chat>> {
    return this.repo.findAll(query, this.scopeClientId(query.clientId, user));
  }

  async findMessages(
    chatId: string,
    query: QueryMessageReplyInput,
    user: SafeUser,
  ): Promise<PaginatedResult<MessageReply>> {
    const chat = await this.repo.findById(
      chatId,
      this.scopeClientId(undefined, user),
    );
    if (!chat) throw new NotFoundException('Conversation not found');
    return this.repo.findMessages(chatId, query);
  }

  findOrCreate(input: z.input<typeof FindOrCreateChatSchema>): Promise<Chat> {
    return this.repo.findOrCreate(FindOrCreateChatSchema.parse(input));
  }

  createMessage(input: CreateMessageReplyInput): Promise<MessageReply> {
    return this.repo.createMessage(CreateMessageReplySchema.parse(input));
  }

  private scopeClientId(
    requestedClientId: string | undefined,
    user: SafeUser,
  ): string | undefined {
    if (user.roles.includes(UserRole.ADMIN)) return requestedClientId;
    if (user.roles.includes(UserRole.CLIENT) && user.clientId) {
      return user.clientId;
    }
    throw new ForbiddenException('User is not assigned to a client');
  }
}
