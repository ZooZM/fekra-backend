// inbox/priority-inbox.service.ts
import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import {
  COMMENT_QUEUE_KEY,
  COMMENT_RETRY_KEY,
  MESSAGE_QUEUE_KEY,
  REDIS,
} from './inbox.constants';
import { InboxAttachment, InboxItem } from './inbox.types';
import { DmBufferService } from './dm-buffer.service';
import { N8nDeliveryService } from './n8n-delivery.service';
import { ConfigService } from '@nestjs/config';
import { ClientsService } from '@app/clients/clients.service';
import { AttachmentHandlerService } from './attachment-handler.service';
import { CommentClassifierService } from './comment-classifier.service';
import { CommentLlmClassifierService } from './comment-llm-classifier.service';
import { CommentReplyService } from './comment-reply.service';
import { CommentsService } from '@app/comments/comments.service';
import { ConversationsService } from '@app/conversations/conversations.service';
import { Chat, CommentDecisionBasis } from '@app/generated/prisma/client';

@Injectable()
export class PriorityInboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriorityInboxService.name);
  private running = false;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly dmBuffer: DmBufferService,
    private readonly delivery: N8nDeliveryService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => ClientsService))
    private readonly clientsService: ClientsService,
    private readonly attachments: AttachmentHandlerService,
    private readonly commentClassifier: CommentClassifierService,
    private readonly commentLlmClassifier: CommentLlmClassifierService,
    private readonly commentReply: CommentReplyService,
    private readonly comments: CommentsService,
    private readonly conversations: ConversationsService,
  ) {}

  private num(name: string, fallback: number): number {
    const value = Number(this.configService.get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /**
   * Never throws, so callers can use `void inbox.push(...)`.
   * Resolves to true if the item was queued, false if it was dropped (duplicate, blocked, rate limited, error).
   * `skipRateLimit` is for items the caller already paces (e.g. the comment backfill).
   */
  async push(
    item: InboxItem,
    opts: { skipRateLimit?: boolean } = {},
  ): Promise<boolean> {
    const seenKey = `inbox:seen:${item.kind}:${item.platform}:${item.id}`;
    try {
      // Meta redeliveries of the same event are dropped here
      const fresh = await this.redis.set(seenKey, '1', 'EX', 3600, 'NX');
      if (!fresh) return false;

      // Checked after the dedupe, so redeliveries don't use up a sender's allowance
      if (!(await this.allowed(item, opts.skipRateLimit))) return false;

      const key =
        item.kind === 'comment' ? COMMENT_QUEUE_KEY : MESSAGE_QUEUE_KEY;
      try {
        await this.redis.zadd(key, item.timestamp, JSON.stringify(item));
      } catch (err) {
        await this.redis.del(seenKey).catch(() => undefined);
        throw err;
      }
      return true;
    } catch (err) {
      this.logger.error(
        `Failed to enqueue ${item.kind} ${item.id}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Blocklist + fixed-window rate limit per sender. */
  private async allowed(
    item: InboxItem,
    skipRateLimit = false,
  ): Promise<boolean> {
    // Batches are already aggregated from messages that were counted individually
    if (item.kind === 'batch' || !item.senderId) return true;

    if (
      await this.redis.sismember(`blocked:${item.accountId}`, item.senderId)
    ) {
      this.logger.warn(
        `Blocked sender ${item.senderId} dropped (${item.kind})`,
      );
      return false;
    }
    if (skipRateLimit) return true;

    const limit =
      item.kind === 'comment'
        ? this.num('RATE_LIMIT_COMMENTS_PER_MIN', 10)
        : this.num('RATE_LIMIT_MESSAGES_PER_MIN', 20);

    const key = `rl:${item.kind}:${item.platform}:${item.accountId}:${item.senderId}`;
    // EXPIRE ... NX (Redis 7+) sets the TTL only on the first hit of the window,
    // and MULTI makes the pair atomic so a crash can't leave a counter without expiry
    const res = await this.redis.multi().incr(key).expire(key, 60, 'NX').exec();
    const count = Number(res?.[0]?.[1] ?? 0);

    if (count > limit) {
      if (count === limit + 1) {
        // log once per window, not once per dropped event
        this.logger.warn(
          `Rate limit hit: ${item.kind} from ${item.senderId} (> ${limit}/min)`,
        );
      }
      return false;
    }
    return true;
  }

  onModuleInit() {
    this.running = true;
    void this.loop();
  }

  onModuleDestroy() {
    this.running = false;
  }

  private async loop() {
    const interval = this.num('DISPATCH_INTERVAL_MS', 1000);
    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(`Dispatch tick failed: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  /** ZPOPMIN is atomic, so several instances never take the same item. */
  private async pop(key: string, count: number): Promise<InboxItem[]> {
    if (count <= 0) return [];
    const raw = await this.redis.zpopmin(key, count); // [member, score, member, score...]
    const items: InboxItem[] = [];
    for (let i = 0; i < raw.length; i += 2) {
      items.push(JSON.parse(raw[i]) as InboxItem);
    }
    return items;
  }

  /**
   * Parks a comment whose LLM call failed, to try again later instead of guessing.
   * Returns false when it's out of attempts, so the caller applies the fallback.
   */
  private async scheduleLlmRetry(
    item: Extract<InboxItem, { kind: 'comment' }>,
    reason: string,
  ): Promise<boolean> {
    const failed = (item.llmAttempts ?? 0) + 1;
    const max = this.num('COMMENT_LLM_MAX_ATTEMPTS', 3);
    if (failed >= max) return false;

    // 5 min, then 10 min... long enough for an outage or a billing top-up
    const delay = this.num('COMMENT_LLM_RETRY_DELAY_MS', 300_000) * failed;
    await this.redis.zadd(
      COMMENT_RETRY_KEY,
      Date.now() + delay,
      JSON.stringify({ ...item, llmAttempts: failed }),
    );
    this.logger.warn(
      `Comment ${item.id}: ${reason}, retrying in ${Math.round(delay / 1000)}s (attempt ${failed + 1}/${max})`,
    );
    return true;
  }

  /**
   * Moves comments whose LLM retry is due back into the comment queue.
   * One Lua script, so it's atomic: nothing is lost on a crash and two instances never move the same item.
   */
  private async promoteDueRetries() {
    await this.redis.eval(
      `local due = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, 100)
       for _, m in ipairs(due) do
         redis.call('ZREM', KEYS[1], m)
         redis.call('ZADD', KEYS[2], cjson.decode(m).timestamp, m)
       end
       return #due`,
      2,
      COMMENT_RETRY_KEY,
      COMMENT_QUEUE_KEY,
      Date.now(),
    );
  }

  private async tick() {
    await this.promoteDueRetries();
    const max = this.num('DISPATCH_BATCH', 5);
    const reserved = Math.min(this.num('DISPATCH_COMMENT_RESERVED', 1), max);

    // 1) messages get everything except the reserved comment slots
    const messages = await this.pop(MESSAGE_QUEUE_KEY, max - reserved);
    // 2) comments get the reserved slots, plus whatever the messages didn't use
    const comments = await this.pop(COMMENT_QUEUE_KEY, max - messages.length);
    // 3) if there weren't enough comments, give the unused slots back to messages
    const spare = max - messages.length - comments.length;
    const moreMessages = await this.pop(MESSAGE_QUEUE_KEY, spare);

    for (const item of [...messages, ...moreMessages, ...comments]) {
      try {
        await this.handle(item);
      } catch (err) {
        this.logger.error(
          `Failed to handle ${item.kind} ${item.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async handle(item: InboxItem) {
    switch (item.kind) {
      case 'message': {
        // Checkpoint 1 (research R2): only a subscribed client's DMs are stored, buffered or
        // sent to Gemini. The route is read fresh, so a subscribe or unsubscribe applies at once.
        const route = await this.clientsService.findChatRoute(item.accountId);
        if (!route?.chatSubscribed) {
          this.logger.warn(
            `Dropped DM ${item.id} for account ${item.accountId}: chat service not subscribed`,
          );
          return;
        }

        let chat: Chat | null = null;
        if (item.senderId) {
          try {
            chat = await this.conversations.findOrCreate({
              clientId: route.clientId,
              platform: item.platform,
              senderId: item.senderId,
              receiverId: item.accountId,
            });
          } catch (err) {
            // fail open: if the chat cannot be read, answer as if it were not paused (R16)
            this.logger.error(
              `Failed to persist conversation for message ${item.id}: ${(err as Error).message}`,
            );
          }
        }

        // A paused conversation: store the message as not answered, spend no LLM call on it
        if (chat && this.conversations.isPaused(chat)) {
          await this.recordPausedMessage(chat.id, item);
          return;
        }

        let order = 0;
        if (item.text) {
          await this.dmBuffer.add(
            item,
            item.text,
            item.id,
            item.timestamp + order++,
          );
        }
        for (const [i, att] of (item.attachments ?? []).entries()) {
          const text = await this.processAttachment(item, att);
          if (text)
            await this.dmBuffer.add(
              item,
              text,
              `${item.id}:${i}`,
              item.timestamp + order++,
            );
        }
        break;
      }

      case 'comment': {
        const client = await this.clientsService.getClientDataForWorkFlow(
          item.accountId,
        );
        if (!client) {
          this.logger.warn(
            `No client for account ${item.accountId}, dropping comment ${item.id}`,
          );
          return;
        }

        const { enabled, likes_enabled } = client.commentReplyConfig;
        if (!enabled && !likes_enabled) {
          // nothing would happen anyway, so don't spend an LLM call on it
          this.logger.debug(
            `Comment automation is off for client ${client.id}, skipping ${item.id}`,
          );
          return;
        }

        // 1) free keyword rules; 2) only if they can't decide, ask the LLM
        let { type, reason, retryable } = this.commentClassifier.classify(
          item.text,
        );
        // How the label was decided, stored with the comment so the model can be judged later
        let decisionBasis: CommentDecisionBasis = 'RULES';
        let decisionModel: string | null = null;
        if (type === 'unsure') {
          const llm = await this.commentLlmClassifier.classify(
            item.text,
            client,
          );
          ({ type, reason, retryable } = llm);
          // an answer without a model name did not come from a model call (empty comment)
          if (llm.model) {
            decisionBasis = 'AI_MODEL';
            decisionModel = llm.model;
          }
        }

        // 'unsure' now means the LLM call itself failed
        if (type === 'unsure') {
          if (retryable && (await this.scheduleLlmRetry(item, reason))) return;
          // the prompt's fallback rule: ambiguous -> spam (like only, never a reply)
          type = 'spam';
          reason = `${reason}, fallback to spam`;
          decisionBasis = 'SAFE_FALLBACK';
          decisionModel = null;
        }
        this.logger.debug(`Comment ${item.id} → ${type} (${reason})`);

        try {
          await this.comments.save({
            clientId: client.id,
            platform: item.platform,
            commentId: item.id,
            comment: item.text ?? '',
            classification: type,
            reason,
            decisionBasis,
            decisionModel,
          });
        } catch (err) {
          this.logger.error(
            `Failed to persist classification for comment ${item.id}: ${(err as Error).message}`,
          );
        }

        // reply / DM / like / hide, handled entirely in Nest (no n8n for comments)
        await this.commentReply.handle(
          { ...item, clientId: client.id, client },
          type,
        );
        break;
      }
      case 'batch': {
        // Checkpoint 2: the DM window and the queue can take seconds, so the subscription and the
        // pause are checked again. One fresh read gives the client's data and its subscription.
        const client = await this.clientsService.findWorkflowDataFresh(
          item.accountId,
        );
        if (!client) {
          this.logger.warn(
            `No client for account ${item.accountId}, dropping ${item.kind} ${item.id}`,
          );
          return;
        }
        if (!client.chatSubscribed) {
          this.logger.warn(
            `Dropped batch ${item.id} for account ${item.accountId}: chat service not subscribed`,
          );
          return;
        }

        if (await this.isChatPaused(client.id, item)) {
          await this.recordPausedBatch(client.id, item);
          return;
        }

        const latestChatMessagesRows =
          await this.conversations.findLastMessagesByIdForWorkflow(
            item.senderId,
            item.accountId,
            item.platform,
          );
        const latestMessages = latestChatMessagesRows;

        // clientId travels with the request: the reply is recorded and the pause is re-checked with it
        await this.delivery.send(item.id, {
          ...item,
          clientId: client.id,
          client,
          latestMessages,
        });
        break;
      }
    }
  }

  /**
   * Finds the batch's conversation and says whether it is paused now. Fails open: when the chat
   * cannot be read the batch is delivered as usual (research R16).
   */
  private async isChatPaused(
    clientId: string,
    item: Extract<InboxItem, { kind: 'batch' }>,
  ): Promise<boolean> {
    try {
      const chat = await this.conversations.findOrCreate({
        clientId,
        platform: item.platform,
        senderId: item.senderId,
        receiverId: item.accountId,
      });
      return this.conversations.isPaused(chat);
    } catch (err) {
      this.logger.warn(
        `Could not check the pause of ${item.id}, delivering: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** A batch that was waiting when the conversation was paused: stored as one unanswered exchange. */
  private async recordPausedBatch(
    clientId: string,
    item: Extract<InboxItem, { kind: 'batch' }>,
  ): Promise<void> {
    try {
      const chat = await this.conversations.findOrCreate({
        clientId,
        platform: item.platform,
        senderId: item.senderId,
        receiverId: item.accountId,
      });
      await this.conversations.createUnansweredMessage({
        chatId: chat.id,
        message: item.messages.map((m) => m.text).join('\n'),
      });
    } catch (err) {
      this.logger.error(
        `Failed to record paused batch ${item.id}: ${(err as Error).message}`,
      );
    }
  }

  /** Each message of a paused conversation becomes its own unanswered exchange. */
  private async recordPausedMessage(
    chatId: string,
    item: Extract<InboxItem, { kind: 'message' }>,
  ): Promise<void> {
    const texts: string[] = [];
    if (item.text) texts.push(item.text);
    // attachments are not sent to Gemini while paused: a placeholder says what arrived
    for (const att of item.attachments ?? []) {
      texts.push(att.type === 'image' ? '[image]' : '[voice message]');
    }
    for (const message of texts) {
      try {
        await this.conversations.createUnansweredMessage({ chatId, message });
      } catch (err) {
        this.logger.error(
          `Failed to record paused message ${item.id}: ${(err as Error).message}`,
        );
      }
    }
  }

  private async processAttachment(
    item: Extract<InboxItem, { kind: 'message' }>,
    att: InboxAttachment,
  ): Promise<string | null> {
    const ctx = {
      platform: item.platform,
      accountId: item.accountId,
      senderId: item.senderId,
      mid: item.id,
      url: att.url,
    };
    try {
      switch (att.type) {
        case 'image':
          return await this.attachments.handleImage(ctx);
        case 'audio':
          return await this.attachments.handleVoiceRecord(ctx);
        default:
          return null;
      }
    } catch (err) {
      // a failed image must not lose the sender's text
      this.logger.warn(
        `${att.type} handling failed for ${item.id}: ${(err as Error).message}`,
      );
      return null;
    }
  }
}
