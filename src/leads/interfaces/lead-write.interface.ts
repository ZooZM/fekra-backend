import { Platform } from '@app/generated/prisma/client';
import { LeadFields } from '@common/zod/json-columns.schema';

/** The unique key of a lead: one customer on one account. */
export interface LeadKey {
  platform: Platform;
  accountId: string;
  senderId: string;
}

/** What a save writes over the stored lead: the result of mergeLead. */
export interface LeadWrite {
  clientId: string;
  stage: string;
  phone: string | null;
  country: string | null;
  lastIntent: string | null;
  summary: string | null;
  fields: LeadFields;
  /** Only when a previous owner's lead is replaced: the new owner was never notified. */
  notifiedAt?: null;
  /** Only when a previous owner's lead is replaced: the new owner's lead starts now. */
  createdAt?: Date;
}
