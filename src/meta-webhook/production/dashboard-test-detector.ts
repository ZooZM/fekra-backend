// production/dashboard-test-detector.ts
import { MetaWebhookPayload } from '../types/meta-webhook.types';

export function isFacebookDashboardTest(p: MetaWebhookPayload): boolean {
  return (p?.entry ?? []).some(
    (e) =>
      e.id === '0' ||
      (e.changes ?? []).some((c) =>
        String(c.value?.post_id ?? '').startsWith('44444444_'),
      ),
  );
}

export function isInstagramDashboardTest(p: MetaWebhookPayload): boolean {
  return (p?.entry ?? []).some(
    (e) =>
      e.id === '0' ||
      (e.changes ?? []).some(
        (c) => String(c.value?.media?.id ?? '') === '123123123',
      ),
  );
}
