// inbox/priority-inbox.service.ts
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { COMMENT_QUEUE_KEY, MESSAGE_QUEUE_KEY, REDIS } from './inbox.constants';
import { InboxAttachment, InboxItem } from './inbox.types';
import { DmBufferService } from './dm-buffer.service';
import { N8nDeliveryService } from './n8n-delivery.service';
import { ConfigService } from '@nestjs/config';
import { ClientsService } from '@app/clients/clients.service';
import { AttachmentHandlerService } from './attachment-handler.service';
import { CommentClassifierService } from './comment-classifier.service';
import { CommentReplyService } from './comment-reply.service';

@Injectable()
export class PriorityInboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PriorityInboxService.name);
  private running = false;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly dmBuffer: DmBufferService,
    private readonly delivery: N8nDeliveryService,
    private readonly configService: ConfigService,
    private readonly clientsService: ClientsService,
    private readonly attachments: AttachmentHandlerService,
    private readonly commentClassifier: CommentClassifierService,
    private readonly commentReply: CommentReplyService,
  ) {}

  private num(name: string, fallback: number): number {
    const value = Number(this.configService.get(name));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  /** Never throws, so callers can use `void inbox.push(...)`. */
  async push(item: InboxItem): Promise<void> {
    const seenKey = `inbox:seen:${item.kind}:${item.platform}:${item.id}`;
    try {
      // Meta redeliveries of the same event are dropped here
      const fresh = await this.redis.set(seenKey, '1', 'EX', 3600, 'NX');
      if (!fresh) return;

      // Checked after the dedupe, so redeliveries don't use up a sender's allowance
      if (!(await this.allowed(item))) return;

      const key =
        item.kind === 'comment' ? COMMENT_QUEUE_KEY : MESSAGE_QUEUE_KEY;
      try {
        await this.redis.zadd(key, item.timestamp, JSON.stringify(item));
      } catch (err) {
        await this.redis.del(seenKey).catch(() => undefined);
        throw err;
      }
    } catch (err) {
      this.logger.error(
        `Failed to enqueue ${item.kind} ${item.id}: ${(err as Error).message}`,
      );
    }
  }

  /** Blocklist + fixed-window rate limit per sender. */
  private async allowed(item: InboxItem): Promise<boolean> {
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

  private async tick() {
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

        const { type, reason } = this.commentClassifier.classify(item.text);
        this.logger.debug(`Comment ${item.id} → ${type} (${reason})`);

        if (type === 'engagement') {
          // handled entirely in Nest: random canned reply + like, no n8n and no LLM cost
          await this.commentReply.handleEngagement({
            ...item,
            clientId: client.id,
            client,
          });
          return;
        }

        // TODO: if the comment is classified as 'inquiry' or 'unsure', send it to a small LLM to decide in one word ("inquiry" or "engagement")
        await this.delivery.send(`${item.platform}-comment-${item.id}`, {
          ...item,
          client,
          commentTypeHint: type, // 'inquiry' or 'unsure': n8n confirms or corrects it
        });
        break;
      }
      case 'batch': {
        const client = await this.clientsService.getClientDataForWorkFlow(
          item.accountId,
        );
        if (!client) {
          this.logger.warn(
            `No client for account ${item.accountId}, dropping ${item.kind} ${item.id}`,
          );
          return;
        }
        const id = item.id;
        await this.delivery.send(id, { ...item, client });
        break;
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
