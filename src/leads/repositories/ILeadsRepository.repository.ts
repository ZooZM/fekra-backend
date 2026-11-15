import { LeadKey, LeadWrite } from '../interfaces/lead-write.interface';
import { LeadRecord, UpsertLeadResult } from '../types/lead.types';

export const LEADS_REPOSITORY = 'LEADS_REPOSITORY';

export interface ILeadsRepository {
  /** The client's lead for this key; null when there is none, or when it is another client's. */
  findByKey(key: LeadKey, clientId: string): Promise<LeadRecord | null>;

  /**
   * One transaction: creates the lead when it is missing, locks it, writes `build(current)` and,
   * with `claimNotification`, sets notifiedAt only if it is still null. `current` is null for a lead
   * this call created. Concurrent saves for the same key run one after the other, so a merge never
   * loses another save's values, and only one of them gets `notifiedNow: true`.
   */
  upsert(
    key: LeadKey,
    clientId: string,
    build: (current: LeadRecord | null) => LeadWrite,
    claimNotification: boolean,
  ): Promise<UpsertLeadResult>;

  /** Retention: deletes leads not updated since `cutoff`, in batches. Returns how many. */
  purgeBefore(cutoff: Date, batch?: number): Promise<number>;
}
