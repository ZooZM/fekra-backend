import { LeadFields } from '@common/zod/json-columns.schema';
import { UpsertLeadInput } from '../schemas/lead.schema';
import { LeadRecord } from '../types/lead.types';
import { LeadWrite } from '../interfaces/lead-write.interface';

/**
 * What a save writes, given the stored lead (`null` for a new one). The merge rules (spec 004
 * FR-005):
 * - `fields`: shallow merge; a non-empty value overwrites, an empty one is ignored (never erases,
 *   never stored);
 * - phone, country, lastIntent, summary: `null`, missing or "" keep the stored value;
 * - stage: always the sent value (the workflow keeps it from moving backwards).
 *
 * A lead stored for another client (the account changed owner) is never merged into: it is
 * replaced by a new lead for the current client, so the previous client's data is never returned.
 */
export function mergeLead(
  current: LeadRecord | null,
  input: UpsertLeadInput,
  now: Date = new Date(),
): LeadWrite {
  const base = current?.clientId === input.clientId ? current : null;
  const write: LeadWrite = {
    clientId: input.clientId,
    stage: input.stage,
    phone: keep(input.phone, base?.phone),
    country: keep(input.country, base?.country),
    lastIntent: keep(input.lastIntent, base?.lastIntent),
    summary: keep(input.summary, base?.summary),
    fields: mergeFields(base?.fields ?? {}, input.fields),
  };
  if (current && !base) {
    write.notifiedAt = null;
    write.createdAt = now;
  }
  return write;
}

/** Non-empty sent values overwrite; empty ones are skipped. */
export function mergeFields(stored: LeadFields, sent: LeadFields): LeadFields {
  const merged: LeadFields = { ...stored };
  for (const [key, value] of Object.entries(sent)) {
    if (value !== '') merged[key] = value;
  }
  return merged;
}

const keep = (
  sent: string | null | undefined,
  stored: string | null | undefined,
): string | null => (sent ? sent : (stored ?? null));
