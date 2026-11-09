import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { Chat, MessageReply } from '@app/generated/prisma/client';
import { FindOrCreateChatInput, QueryChatInput } from '../schemas/chat.schema';
import {
  CreateMessageReplyInput,
  QueryMessageReplyInput,
} from '../schemas/message-reply.schema';

export const CONVERSATIONS_REPOSITORY = 'CONVERSATIONS_REPOSITORY';

export interface IConversationsRepository {
  findAll(
    query: QueryChatInput,
    clientId?: string,
  ): Promise<PaginatedResult<Chat>>;
  findById(chatId: string, clientId?: string): Promise<Chat | null>;
  findMessages(
    chatId: string,
    query: QueryMessageReplyInput,
  ): Promise<PaginatedResult<MessageReply>>;
  findOrCreate(data: FindOrCreateChatInput): Promise<Chat>;
  createMessage(data: CreateMessageReplyInput): Promise<MessageReply>;
}
