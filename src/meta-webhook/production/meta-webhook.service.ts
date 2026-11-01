// production/meta-webhook.service.ts
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  MetaChange,
  MetaEntry,
  MetaFeedValue,
  MetaMessagingEvent,
  MetaWebhookPayload,
} from '../types/meta-request.type';
import { PriorityInboxService } from '@app/inbox/priority-inbox.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MetaWebhookService {
  constructor(
    private readonly inbox: PriorityInboxService,
    private readonly configService: ConfigService,
  ) {}

  private readonly logger = new Logger(MetaWebhookService.name);

  verifyChallenge(mode: string | undefined, token: string | undefined): void {
    const expectedToken = this.configService.get<string>('META_VERIFY_TOKEN');
    if (!expectedToken) {
      throw new InternalServerErrorException(
        'META_VERIFY_TOKEN is not configured',
      );
    }
    if (mode !== 'subscribe' || token !== expectedToken) {
      throw new BadRequestException('Invalid Meta webhook verification');
    }
  }

  verifySignature(
    rawBody: Buffer | undefined,
    signature: string | undefined,
  ): void {
    const secrets = [
      this.configService.get<string>('META_APP_SECRET'),
      this.configService.get<string>('INSTAGRAM_APP_SECRET'),
    ].filter((s): s is string => !!s);

    if (secrets.length === 0) {
      throw new InternalServerErrorException(
        'META_APP_SECRET is not configured',
      );
    }
    if (!rawBody || !signature?.startsWith('sha256=')) {
      throw new BadRequestException('Missing Meta webhook signature');
    }

    const received = Buffer.from(signature.slice('sha256='.length), 'hex');

    const valid = secrets.some((secret) => {
      const expected = createHmac('sha256', secret).update(rawBody).digest();
      return (
        received.length === expected.length &&
        timingSafeEqual(received, expected)
      );
    });

    if (!valid) throw new BadRequestException('Invalid Meta webhook signature');
  }

  handleEvent(payload: MetaWebhookPayload): void {
    if (typeof payload !== 'object' || payload === null) {
      this.logger.warn('Invalid payload');
      return;
    }
    if (payload.object !== 'page') {
      this.logger.debug(`Ignoring object type: ${payload.object}`);
      return;
    }

    this.logger.log(`Received Meta webhook event: ${JSON.stringify(payload)}`);

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? [])
        this.handleChange(entry, change);
      for (const event of entry.messaging ?? [])
        this.handleMessagingEvent(entry, event);
    }
  }

  private handleChange(entry: MetaEntry, change: MetaChange): void {
    switch (change.field) {
      case 'feed':
        this.handleFeedEvent(entry, change.value as MetaFeedValue);
        break;
      default:
        this.logger.debug(`Unhandled field: ${change.field}`);
    }
  }

  private handleFeedEvent(entry: MetaEntry, value: MetaFeedValue): void {
    if (value.item !== 'comment' || value.verb !== 'add') return;
    if (value.from?.id === entry.id) return; // our own comment

    this.logger.log(
      `New comment ${value.comment_id} from ${value.from?.id}: ${value.message}`,
    );

    // TODO: forward to n8n
    // in handleFeedEvent, after the filters
    void this.inbox.push({
      kind: 'comment',
      platform: 'facebook',
      id: value.comment_id!,
      accountId: entry.id,
      senderId: value.from?.id,
      text: value.message,
      postId: value.post_id,
      timestamp: (value.created_time ?? Math.floor(Date.now() / 1000)) * 1000,
      raw: value,
    });
  }

  private handleMessagingEvent(
    entry: MetaEntry,
    event: MetaMessagingEvent,
  ): void {
    if (event.message?.is_echo) return;
    if (event.sender?.id === entry.id) return;
    if (!event.message?.text) return;

    this.logger.log(`New DM ${event.message.mid} from ${event.sender?.id}`);
    // TODO: forward to n8n

    // in handleMessagingEvent, after the filters
    void this.inbox.push({
      kind: 'message',
      platform: 'facebook',
      id: event.message.mid,
      accountId: entry.id,
      senderId: event.sender!.id,
      text: event.message.text,
      timestamp: event.timestamp ?? Date.now(),
    });
  }
}
