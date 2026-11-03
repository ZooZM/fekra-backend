// dashboard-test/meta-dashboard-test.service.ts
import { Injectable, Logger } from '@nestjs/common';
import {
  MetaFeedValue,
  MetaMessagesChangeValue,
  MetaWebhookPayload,
} from '../../../types/meta-webhook.types';

export interface CapturedPayload {
  receivedAt: string;
  payload: MetaWebhookPayload;
}

@Injectable()
export class MetaDashboardTestService {
  private readonly logger = new Logger(MetaDashboardTestService.name);
  private readonly captured: CapturedPayload[] = [];
  private static readonly MAX_CAPTURED = 20;

  /** Dashboard Test payloads use entry.id "0" and/or fake post ids like 44444444_444444444. */
  isDashboardTest(payload: MetaWebhookPayload): boolean {
    return (payload?.entry ?? []).some(
      (entry) =>
        entry.id === '0' ||
        (entry.changes ?? []).some((c) =>
          String(c.value?.post_id ?? '').startsWith('44444444_'),
        ),
    );
  }

  /** Log a summary and keep the payload for inspection. Never forwards or replies. */
  handle(payload: MetaWebhookPayload): void {
    this.captured.unshift({ receivedAt: new Date().toISOString(), payload });
    this.captured.length = Math.min(
      this.captured.length,
      MetaDashboardTestService.MAX_CAPTURED,
    );

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field === 'feed') {
          const v = change.value as MetaFeedValue;
          this.logger.log(
            `[DASHBOARD TEST] feed item=${v.item} verb=${v.verb} from=${v.from?.id}`,
          );
        } else if (change.field === 'messages') {
          const v = change.value as MetaMessagesChangeValue;
          this.logger.log(
            `[DASHBOARD TEST] messages from=${v.sender?.id} to=${v.recipient?.id} text=${v.message?.text}`,
          );
        } else {
          this.logger.log(`[DASHBOARD TEST] field=${change.field}`);
        }
      }
      for (const event of entry.messaging ?? []) {
        this.logger.log(
          `[DASHBOARD TEST] messaging from=${event.sender?.id} text=${event.message?.text}`,
        );
      }
    }
  }

  list(): CapturedPayload[] {
    return this.captured;
  }

  get(index: number): CapturedPayload | undefined {
    return this.captured[index];
  }
}
