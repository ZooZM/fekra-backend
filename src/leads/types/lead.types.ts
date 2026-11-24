import { Lead } from '@app/generated/prisma/client';
import { LeadFields } from '@common/zod/json-columns.schema';
import { ExchangeSummary } from '@app/conversations/types/chat.types';

/** A lead as the API returns it: the row with `fields` parsed. */
export type LeadRecord = Omit<Lead, 'fields'> & { fields: LeadFields };

/** GET /n8n/leads/context. */
export interface LeadContext {
  /** null when this client has no lead for the customer yet. */
  lead: LeadRecord | null;
  /** The latest exchanges, oldest first. */
  history: ExchangeSummary[];
}

/** POST /n8n/leads. */
export interface UpsertLeadResult {
  lead: LeadRecord;
  /** true only for the save that set notifiedAt. */
  notifiedNow: boolean;
}

/** Minimal lead identity needed to replay a stale chat through n8n. */
export interface StaleLeadCandidate {
  id: string;
  clientId: string | null;
  platform: Lead['platform'] | null;
  accountId: string | null;
  senderId: string | null;
  stage: string | null;
  phone: string | null;
  country: string | null;
  lastIntent: string | null;
  summary: string | null;
  notifiedAt: Date | null;
  updatedAt: Date;
}

export interface StaleLeadCursor {
  id: string;
  updatedAt: Date;
}
