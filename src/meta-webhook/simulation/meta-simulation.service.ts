// simulation/meta-simulation.service.ts
import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MetaWebhookPayload } from '../types/meta-request.type';
import { ConfigService } from '@nestjs/config';

export interface SimCommentOptions {
  pageId?: string;
  commentId?: string;
  postId?: string;
  message?: string;
  fromId?: string;
  fromName?: string;
}

export interface SimDmOptions {
  pageId?: string;
  senderId?: string;
  text?: string;
}

@Injectable()
export class MetaSimulationService {
  constructor(private readonly configService: ConfigService) {}

  private get pageId(): string {
    return this.configService.get<string>('META_PAGE_ID') ?? '111111111111111';
  }

  buildComment(opts: SimCommentOptions = {}): MetaWebhookPayload {
    const now = Math.floor(Date.now() / 1000);
    const pageId = opts.pageId ?? this.pageId;
    const postId = opts.postId ?? `${pageId}_${now}1`;

    return {
      object: 'page',
      entry: [
        {
          id: pageId,
          time: now,
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: 'add',
                comment_id: opts.commentId ?? `${postId}_${now}2`,
                post_id: postId,
                parent_id: postId,
                message: opts.message ?? 'Test comment',
                from: {
                  id: opts.fromId ?? '999999999999999',
                  name: opts.fromName ?? 'Test User',
                },
                created_time: now,
              },
            },
          ],
        },
      ],
    };
  }

  buildDm(opts: SimDmOptions = {}): MetaWebhookPayload {
    const now = Date.now();
    const pageId = opts.pageId ?? this.pageId;

    return {
      object: 'page',
      entry: [
        {
          id: pageId,
          time: now,
          messaging: [
            {
              sender: { id: opts.senderId ?? '999999999999999' },
              recipient: { id: pageId },
              timestamp: now,
              message: {
                mid: `m_sim_${now}`,
                text: opts.text ?? 'Test message',
              },
            },
          ],
        },
      ],
    };
  }

  /** Signs the payload like Meta does and POSTs it to our own production endpoint. */
  async send(
    payload: MetaWebhookPayload,
  ): Promise<{ status: number; body: string }> {
    const secret = this.configService.get<string>('META_APP_SECRET');
    if (!secret) throw new Error('META_APP_SECRET is not configured');

    const body = JSON.stringify(payload);
    const signature =
      'sha256=' + createHmac('sha256', secret).update(body).digest('hex');

    const response = await fetch(
      `http://127.0.0.1:${this.configService.get<string>('PORT') ?? 3000}/webhooks/meta`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signature,
        },
        body,
      },
    );
    return { status: response.status, body: await response.text() };
  }
}
