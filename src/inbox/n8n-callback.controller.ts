// inbox/n8n-callback.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { N8nDeliveryService } from './n8n-delivery.service';
import { MessageSenderService } from './message-sender.service';
import { CommentReplyService, CommentType } from './comment-reply.service';
import { SendableRequest } from './graph-api.service';

// inbox/n8n-callback.controller.ts
@Controller('n8n')
export class N8nCallbackController {
  constructor(
    private readonly delivery: N8nDeliveryService,
    private readonly messageSender: MessageSenderService,
    private readonly commentReply: CommentReplyService,
    private readonly config: ConfigService,
  ) {}

  @Post('callback')
  @HttpCode(200)
  async callback(
    @Body()
    body: {
      id?: string;
      text?: string; // DM batch reply
      type?: CommentType; // comments only
      publicReply?: string;
      dmText?: string;
      publicReplyIfDmSent?: string;
      publicReplyIfDmClosed?: string;
    },
    @Headers('x-webhook-secret') secret: string | undefined,
  ) {
    if (!this.isAuthorized(secret)) throw new UnauthorizedException();
    if (!body?.id) throw new BadRequestException('id is required');
    if (body.type && !['engagement', 'question'].includes(body.type)) {
      throw new BadRequestException('type must be engagement or question');
    }

    const pending = await this.delivery.take(body.id);
    if (!pending) return { acknowledged: false }; // duplicate or expired

    const req = pending.payload as SendableRequest;

    if (req.kind === 'batch') {
      const text = body.text?.trim();
      if (text) void this.messageSender.reply(req, text);
    } else {
      void this.commentReply.handleN8nReply(req, {
        type: body.type ?? 'engagement',
        publicReply: body.publicReply?.trim(),
        dmText: body.dmText?.trim(),
        publicReplyIfDmSent: body.publicReplyIfDmSent?.trim(),
        publicReplyIfDmClosed: body.publicReplyIfDmClosed?.trim(),
      });
    }
    return { acknowledged: true };
  }

  /**
   * The shared secret n8n sends. Read through ConfigService and compared in constant time, so the
   * response time cannot be used to guess it (constitution IV, VIII). Different lengths are
   * refused without comparing, because timingSafeEqual needs equal lengths.
   */
  private isAuthorized(provided: string | undefined): boolean {
    const expected = this.config.get<string>('N8N_WEBHOOK_SECRET');
    if (!expected || !provided) return false;
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
