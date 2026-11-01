// instagram/instagram-dashboard-test.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  MetaInstagramCommentValue,
  MetaMessagesChangeValue,
  MetaWebhookPayload,
} from '../types/meta-request.type';

export interface CapturedIgPayload {
  receivedAt: string;
  payload: MetaWebhookPayload;
}

@Injectable()
export class InstagramDashboardTestService {
  private readonly logger = new Logger(InstagramDashboardTestService.name);
  private readonly captured: CapturedIgPayload[] = [];
  private static readonly MAX_CAPTURED = 20;

  /** Dashboard tests use entry.id "0" and/or the fake media id 123123123. */
  isDashboardTest(payload: MetaWebhookPayload): boolean {
    return (payload?.entry ?? []).some(
      (entry) =>
        entry.id === '0' ||
        (entry.changes ?? []).some(
          (c) => String(c.value?.media?.id ?? '') === '123123123',
        ),
    );
  }

  handle(payload: MetaWebhookPayload): void {
    this.captured.unshift({ receivedAt: new Date().toISOString(), payload });
    this.captured.length = Math.min(
      this.captured.length,
      InstagramDashboardTestService.MAX_CAPTURED,
    );

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === 'comments') {
          const v = change.value as MetaInstagramCommentValue;
          this.logger.log(
            `[IG DASHBOARD TEST] comments id=${v.id} from=${v.from?.id} text=${v.text}`,
          );
        } else if (change.field === 'messages') {
          const v = change.value as MetaMessagesChangeValue;
          this.logger.log(
            `[IG DASHBOARD TEST] messages from=${v.sender?.id} text=${v.message?.text}`,
          );
        } else {
          this.logger.log(`[IG DASHBOARD TEST] field=${change.field}`);
        }
      }
      for (const event of entry.messaging ?? []) {
        this.logger.log(
          `[IG DASHBOARD TEST] messaging from=${event.sender?.id} text=${event.message?.text}`,
        );
      }
    }
  }

  list(): CapturedIgPayload[] {
    return this.captured;
  }

  get(index: number): CapturedIgPayload | undefined {
    return this.captured[index];
  }
}
