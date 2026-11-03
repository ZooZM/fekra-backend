// inbox/attachment-handler.service.ts
import { Injectable } from '@nestjs/common';

export interface AttachmentContext {
  platform: 'facebook' | 'instagram';
  accountId: string;
  senderId: string;
  mid: string;
  url: string;
}

@Injectable()
export class AttachmentHandlerService {
  /** Return text to add to the sender's batch (a description, extracted text...), or null to add nothing. */
  async handleImage(ctx: AttachmentContext): Promise<string | null> {
    console.log('handleImage', ctx);
    // TODO
    return null;
  }

  /** Return text to add to the sender's batch (a transcript...), or null to add nothing. */
  async handleVoiceRecord(ctx: AttachmentContext): Promise<string | null> {
    console.log('handleVoiceRecord', ctx);
    // TODO
    return null;
  }
}
