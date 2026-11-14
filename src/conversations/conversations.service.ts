import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '@app/users/types/safe-user.type';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import {
  FindOrCreateChatSchema,
  PauseChatInput,
  QueryChatInput,
} from './schemas/chat.schema';
import {
  CreateMessageReplyInput,
  CreateMessageReplySchema,
  CreateUnansweredMessageInput,
  CreateUnansweredMessageSchema,
  QueryMessageReplyInput,
} from './schemas/message-reply.schema';
import { Chat, MessageReply } from '@app/generated/prisma/client';
import {
  CONVERSATIONS_REPOSITORY,
  IConversationsRepository,
} from './repositories/IConversationsRepository.repository';
import { isEffectivelyPaused, toChatRecord } from './mappers/chat.mapper';
import {
  ChatRecord,
  ChatRowWithClient,
  PAUSE_DURATION_MS,
} from './types/chat.types';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    @Inject(CONVERSATIONS_REPOSITORY)
    private readonly repo: IConversationsRepository,
  ) {}

  async findAll(
    query: QueryChatInput,
    user: SafeUser,
  ): Promise<PaginatedResult<ChatRecord>> {
    const page = await this.repo.findAll(
      query,
      this.scopeClientId(query.clientId, user),
    );
    const last = await this.repo.lastExchanges(page.data.map((c) => c.id));
    const now = new Date();
    const isAdmin = this.isAdmin(user);
    return {
      ...page,
      data: page.data.map((row) =>
        toChatRecord(row, last.get(row.id) ?? null, { isAdmin, now }),
      ),
    };
  }

  async findOne(chatId: string, user: SafeUser): Promise<ChatRecord> {
    const chat = await this.findScoped(chatId, user);
    return this.toRecord(chat, user);
  }

  async findMessages(
    chatId: string,
    query: QueryMessageReplyInput,
    user: SafeUser,
  ): Promise<PaginatedResult<MessageReply>> {
    await this.findScoped(chatId, user);
    return this.repo.findMessages(chatId, query);
  }

  /** Pausing a paused conversation replaces its duration (and records it). */
  async pause(
    chatId: string,
    input: PauseChatInput,
    user: SafeUser,
  ): Promise<ChatRecord> {
    await this.findScoped(chatId, user);
    const ms = PAUSE_DURATION_MS[input.duration];
    const until = ms === null ? null : new Date(Date.now() + ms);
    const updated = await this.repo.pause(chatId, until, input.duration, {
      id: user.id,
      name: user.name,
    });
    this.logger.log(
      `Chat ${chatId} paused (${input.duration}) by user ${user.id}`,
    );
    return this.toRecord(updated, user);
  }

  /** On a conversation that is not paused now (also an expired timed pause) this changes nothing. */
  async resume(chatId: string, user: SafeUser): Promise<ChatRecord> {
    const chat = await this.findScoped(chatId, user);
    if (!isEffectivelyPaused(chat)) return this.toRecord(chat, user);
    const updated = await this.repo.resume(chatId, {
      id: user.id,
      name: user.name,
    });
    this.logger.log(`Chat ${chatId} resumed by user ${user.id}`);
    return this.toRecord(updated, user);
  }

  /** True while the assistant must not answer this conversation. */
  isPaused(chat: Pick<Chat, 'pausedAt' | 'pausedUntil'>): boolean {
    return isEffectivelyPaused(chat);
  }

  findOrCreate(input: z.input<typeof FindOrCreateChatSchema>): Promise<Chat> {
    return this.repo.findOrCreate(FindOrCreateChatSchema.parse(input));
  }

  createMessage(input: CreateMessageReplyInput): Promise<MessageReply> {
    return this.repo.createMessage(CreateMessageReplySchema.parse(input));
  }

  createUnansweredMessage(
    input: CreateUnansweredMessageInput,
  ): Promise<MessageReply> {
    return this.repo.createUnansweredMessage(
      CreateUnansweredMessageSchema.parse(input),
    );
  }

  /** Called by the retention run: deletes what is older than the cutoff. */
  purgeBefore(cutoff: Date): Promise<{ chats: number; exchanges: number }> {
    return this.repo.purgeBefore(cutoff);
  }

  /** Called by ChatPauseSweeper. Returns how many pauses it released. */
  releaseExpiredPauses(): Promise<number> {
    return this.repo.releaseExpiredPauses(new Date());
  }

  private async findScoped(
    chatId: string,
    user: SafeUser,
  ): Promise<ChatRowWithClient> {
    const chat = await this.repo.findById(
      chatId,
      this.scopeClientId(undefined, user),
    );
    if (!chat) throw new NotFoundException('Conversation not found');
    return chat;
  }

  private async toRecord(
    chat: ChatRowWithClient,
    user: SafeUser,
  ): Promise<ChatRecord> {
    const last = await this.repo.lastExchanges([chat.id]);
    return toChatRecord(chat, last.get(chat.id) ?? null, {
      isAdmin: this.isAdmin(user),
    });
  }

  private isAdmin(user: SafeUser): boolean {
    return user.roles.includes(UserRole.ADMIN);
  }

  private scopeClientId(
    requestedClientId: string | undefined,
    user: SafeUser,
  ): string | undefined {
    if (this.isAdmin(user)) return requestedClientId;
    if (user.roles.includes(UserRole.CLIENT) && user.clientId) {
      return user.clientId;
    }
    throw new ForbiddenException('User is not assigned to a client');
  }
}
