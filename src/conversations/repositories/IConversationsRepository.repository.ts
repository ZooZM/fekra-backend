import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { Chat, MessageReply } from '@app/generated/prisma/client';
import { FindOrCreateChatInput, QueryChatInput } from '../schemas/chat.schema';
import {
  CreateMessageReplyInput,
  CreateUnansweredMessageInput,
  QueryMessageReplyInput,
} from '../schemas/message-reply.schema';
import {
  ChatRowWithClient,
  ExchangeSummary,
  LastExchange,
  PauseActor,
  PauseDuration,
  RecentExchangesQuery,
} from '../types/chat.types';
import { Platform } from '@app/inbox/inbox.types';

export const CONVERSATIONS_REPOSITORY = 'CONVERSATIONS_REPOSITORY';

export interface IConversationsRepository {
  findAll(
    query: QueryChatInput,
    clientId?: string,
  ): Promise<PaginatedResult<ChatRowWithClient>>;
  findById(
    chatId: string,
    clientId?: string,
  ): Promise<ChatRowWithClient | null>;
  /** The newest exchange of each chat (message and reply cut to 200 characters). */
  lastExchanges(chatIds: string[]): Promise<Map<string, LastExchange>>;
  findLastMessagesByIdForWorkflow(
    senderId: string,
    receiverId: string,
    platform: Platform,
  ): Promise<MessageReply[]>;
  findMessages(
    chatId: string,
    query: QueryMessageReplyInput,
  ): Promise<PaginatedResult<MessageReply>>;
  /**
   * The last `limit` exchanges of the client's conversation with the customer, oldest first,
   * unanswered ones included. [] when there is no such conversation (another client's conversation
   * on the same account does not count). Creates nothing.
   */
  findRecentExchanges(query: RecentExchangesQuery): Promise<ExchangeSummary[]>;
  findOrCreate(data: FindOrCreateChatInput): Promise<Chat>;
  createMessage(data: CreateMessageReplyInput): Promise<MessageReply>;
  /** A customer message the assistant did not answer: reply '' and answered = false. */
  createUnansweredMessage(
    data: CreateUnansweredMessageInput,
  ): Promise<MessageReply>;
  /** Sets the pause and records a PAUSED event in one transaction. `until` null = until resumed. */
  pause(
    chatId: string,
    until: Date | null,
    duration: PauseDuration,
    actor: PauseActor,
  ): Promise<ChatRowWithClient>;
  /** Clears the pause and records a RESUMED event by the actor, in one transaction. */
  resume(chatId: string, actor: PauseActor): Promise<ChatRowWithClient>;
  /**
   * Clears every timed pause that has ended and records an automatic RESUMED event for each,
   * dated at the scheduled end. Safe to run on several instances. Returns how many it released.
   */
  releaseExpiredPauses(now: Date): Promise<number>;
  /**
   * Retention (FR-049): deletes conversations with no activity since `cutoff` (their exchanges and
   * pause events go with them), then the older exchanges of the conversations that stay. Deletes
   * in batches so locks stay short. Returns what it deleted.
   */
  purgeBefore(
    cutoff: Date,
    batch?: number,
  ): Promise<{ chats: number; exchanges: number }>;
}
