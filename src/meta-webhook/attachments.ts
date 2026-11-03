// meta-webhook/attachments.ts
import { MetaMessagingEvent } from './types/meta-webhook.types';
import { InboxAttachment } from '@app/inbox/inbox.types';

export function extractAttachments(
  message?: MetaMessagingEvent['message'],
): InboxAttachment[] {
  const out: InboxAttachment[] = [];
  for (const a of message?.attachments ?? []) {
    const url = a.payload?.url;
    if (!url) continue;
    if (a.payload?.sticker_id) continue; // stickers and the thumbs-up button arrive as images
    if (a.type === 'image' || a.type === 'audio')
      out.push({ type: a.type, url });
    // video, file, location, shares, etc. are ignored
  }
  return out;
}
