// inbox/n8n-callback.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { N8nSecretGuard } from '@common/guards/n8n-secret.guard';
import { N8nDeliveryService } from './n8n-delivery.service';
import { MessageSenderService } from './message-sender.service';
import { CommentReplyService, CommentType } from './comment-reply.service';
import { SendableRequest } from './graph-api.service';

// inbox/n8n-callback.controller.ts
// No JWT: n8n proves itself with the shared secret (N8nSecretGuard, constant-time, 401 otherwise).
@Controller('n8n')
@UseGuards(N8nSecretGuard)
export class N8nCallbackController {
  constructor(
    private readonly delivery: N8nDeliveryService,
    private readonly messageSender: MessageSenderService,
    private readonly commentReply: CommentReplyService,
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
  ) {
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
}
