// inbox/comment-reply.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ClientsService } from '@app/clients/clients.service';
import { GraphApiService, SendableRequest } from './graph-api.service';

export type CommentType = 'engagement' | 'question';

export interface CommentReplyInput {
  type: CommentType;
  publicReply?: string; // engagement
  dmText?: string; // question
  publicReplyIfDmSent?: string; // question, DM went through
  publicReplyIfDmClosed?: string; // question, DM failed
}

@Injectable()
export class CommentReplyService {
  private readonly logger = new Logger(CommentReplyService.name);

  constructor(
    private readonly graph: GraphApiService,
    private readonly clients: ClientsService,
  ) {}

  async handleEngagement(req: SendableRequest): Promise<void> {
    let reply;
    try {
      const token = await this.clients.getAccessToken(req.clientId);
      if (!token) throw new Error('No access token stored for this client');
      const base = this.graph.host(req.platform);
      const engagementReplies = req.client!.commentReplyConfig.engagement;

      const randomIndex = Math.floor(Math.random() * engagementReplies.length);

      reply = engagementReplies[randomIndex];

      await this.like(req, base, token);

      if (reply) {
        await this.publicReply(req, base, token, reply);
      }
    } catch (err) {
      this.logger.error(
        `Comment handling failed for ${req.id}: ${(err as Error).message}`,
      );
      await this.graph.deadLetter({
        service: 'comment',
        request: req,
        input: { type: 'engagement', reply },
        error: (err as Error).message,
      });
    }
  }

  /** Never throws, so callers can use `void commentReply.handle(...)`. */
  async handle(req: SendableRequest, input: CommentReplyInput): Promise<void> {
    try {
      const token = await this.clients.getAccessToken(req.clientId);
      if (!token) throw new Error('No access token stored for this client');
      const base = this.graph.host(req.platform);

      await this.like(req, base, token); // both types, failure never blocks the reply

      if (input.type === 'question') {
        const dmSent = await this.tryPrivateDm(req, base, token, input.dmText);
        const text = dmSent
          ? input.publicReplyIfDmSent
          : input.publicReplyIfDmClosed;
        if (text) await this.publicReply(req, base, token, text);
      } else if (input.publicReply) {
        await this.publicReply(req, base, token, input.publicReply);
      }
    } catch (err) {
      this.logger.error(
        `Comment handling failed for ${req.id}: ${(err as Error).message}`,
      );
      await this.graph.deadLetter({
        service: 'comment',
        request: req,
        input,
        error: (err as Error).message,
      });
    }
  }

  private async like(req: SendableRequest, base: string, token: string) {
    // As far as I know the Instagram API has no endpoint for liking comments, so it's Facebook only
    if (req.platform !== 'facebook') return;
    try {
      await this.graph.post(`${base}/${req.id}/likes`, {}, token);
    } catch (err) {
      this.logger.warn(`Like failed for ${req.id}: ${(err as Error).message}`);
    }
  }

  /** True only if the DM was actually sent. A failure here is expected (closed DMs). */
  private async tryPrivateDm(
    req: SendableRequest,
    base: string,
    token: string,
    text?: string,
  ) {
    if (!text) return false;
    try {
      await this.graph.post(
        `${base}/${req.accountId}/messages`,
        {
          recipient: { comment_id: req.id },
          message: { text: text.slice(0, 2000) },
        },
        token,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `Private reply not sent for ${req.id}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async publicReply(
    req: SendableRequest,
    base: string,
    token: string,
    text: string,
  ) {
    // https://graph.facebook.com/v24.0/{{ $('Normalize Data').item.json.reply_id }}/comments
    const edge = req.platform === 'instagram' ? 'replies' : 'comments';
    await this.graph.post(
      `${base}/${req.id}/${edge}`,
      { message: text },
      token,
    );
  }
}
