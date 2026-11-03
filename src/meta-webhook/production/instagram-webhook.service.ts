// instagram/instagram-webhook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  MetaChange,
  MetaEntry,
  MetaInstagramCommentValue,
  MetaMessagingEvent,
  MetaWebhookPayload,
} from '../types/meta-webhook.types';
import { PriorityInboxService } from '@app/inbox/priority-inbox.service';
import { extractAttachments } from '../attachments';

@Injectable()
export class InstagramWebhookService {
  constructor(private readonly inbox: PriorityInboxService) {}

  private readonly logger = new Logger(InstagramWebhookService.name);

  handleEvent(payload: MetaWebhookPayload): void {
    this.logger.log(
      `Received Instagram webhook event: ${JSON.stringify(payload)}`,
    );

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? [])
        this.handleChange(entry, change);
      for (const event of entry.messaging ?? [])
        this.handleMessagingEvent(entry, event);
    }
  }

  private handleChange(entry: MetaEntry, change: MetaChange): void {
    switch (change.field) {
      case 'comments':
        this.handleComment(entry, change.value as MetaInstagramCommentValue);
        break;
      default:
        this.logger.debug(`Unhandled Instagram field: ${change.field}`);
    }
  }

  private handleComment(
    entry: MetaEntry,
    value: MetaInstagramCommentValue,
  ): void {
    if (!value.text) return;
    if (value.from?.id === entry.id) return; // our own comment or reply (prevents loops)

    this.logger.log(
      `New IG comment ${value.id} on media ${value.media?.id} from ${value.from?.id}: ${value.text}`,
    );

    // in handleComment
    void this.inbox.push({
      kind: 'comment',
      platform: 'instagram',
      id: value.id,
      accountId: entry.id,
      senderId: value.from?.id,
      text: value.text,
      postId: value.media?.id,
      timestamp: Date.now(),
      raw: value,
    });

    // Reply: POST /{value.id}/replies  { message }
  }

  private handleMessagingEvent(
    entry: MetaEntry,
    event: MetaMessagingEvent,
  ): void {
    if (event.message?.is_echo) return;
    if (event.sender?.id === entry.id) return;

    const text = event.message?.text;
    const attachments = extractAttachments(event.message);
    if (!event.message || (!text && attachments.length === 0)) return; // e.g. video only

    this.logger.log(`New IG DM ${event.message.mid} from ${event.sender?.id}`);

    void this.inbox.push({
      kind: 'message',
      platform: 'facebook', // 'instagram' in InstagramWebhookService
      id: event.message.mid,
      accountId: entry.id,
      senderId: event.sender!.id,
      text,
      attachments,
      timestamp: event.timestamp ?? Date.now(),
    });
  }
}
