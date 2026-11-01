// instagram/instagram-simulation.service.ts
import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { MetaWebhookPayload } from '../types/meta-request.type';
import { ConfigService } from '@nestjs/config';

export interface SimIgCommentOptions {
  igUserId?: string;
  commentId?: string;
  mediaId?: string;
  parentId?: string;
  text?: string;
  fromId?: string;
  fromUsername?: string;
}

export interface SimIgDmOptions {
  igUserId?: string;
  senderId?: string;
  text?: string;
}

@Injectable()
export class InstagramSimulationService {
  constructor(private readonly configService: ConfigService) {}

  private get igUserId(): string {
    return (
      this.configService.get<string>('META_IG_USER_ID') ?? '17841400000000000'
    );
  }

  buildComment(opts: SimIgCommentOptions = {}): MetaWebhookPayload {
    const now = Math.floor(Date.now() / 1000);
    const igUserId = opts.igUserId ?? this.igUserId;

    return {
      object: 'instagram',
      entry: [
        {
          id: igUserId,
          time: now,
          changes: [
            {
              field: 'comments',
              value: {
                id: opts.commentId ?? `1790000${now}`,
                text: opts.text ?? 'Test IG comment',
                ...(opts.parentId ? { parent_id: opts.parentId } : {}),
                from: {
                  id: opts.fromId ?? '17841499999999999',
                  username: opts.fromUsername ?? 'test_user',
                },
                media: {
                  id: opts.mediaId ?? `1780000${now}`,
                  media_product_type: 'FEED',
                },
              },
            },
          ],
        },
      ],
    };
  }

  buildDm(opts: SimIgDmOptions = {}): MetaWebhookPayload {
    const now = Date.now();
    const igUserId = opts.igUserId ?? this.igUserId;

    return {
      object: 'instagram',
      entry: [
        {
          id: igUserId,
          time: now,
          messaging: [
            {
              sender: { id: opts.senderId ?? '17841499999999999' },
              recipient: { id: igUserId },
              timestamp: now,
              message: {
                mid: `ig_sim_${now}`,
                text: opts.text ?? 'Test IG message',
              },
            },
          ],
        },
      ],
    };
  }

  /** Signs like Meta and POSTs to our own production endpoint. */
  async send(
    payload: MetaWebhookPayload,
  ): Promise<{ status: number; body: string }> {
    const secret =
      this.configService.get<string>('INSTAGRAM_APP_SECRET') ??
      this.configService.get<string>('META_APP_SECRET');
    if (!secret)
      throw new Error(
        'INSTAGRAM_APP_SECRET / META_APP_SECRET is not configured',
      );

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
