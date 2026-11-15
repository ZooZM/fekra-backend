import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { platformField } from '@common/zod/meta-fields';
import { externalId, storableText } from '@common/zod/storage-fields';
import {
  LEAD_FIELD_KEY_MAX,
  LEAD_FIELD_VALUE_MAX,
} from '@common/zod/json-columns.schema';

// Called only by the n8n chat workflows (feature 004). The field names are fixed by the workflow
// that is already built: do not rename them.

export const LEAD_FIELDS_MAX_PER_REQUEST = 30;
export const HISTORY_LIMIT_MAX = 50;
export const HISTORY_LIMIT_DEFAULT = 10;

/** One customer (senderId) on one client account (accountId), and the client that owns it. */
const leadKey = {
  clientId: z.uuid(),
  platform: platformField, // facebook | instagram, any case → FACEBOOK | INSTAGRAM
  accountId: externalId, // Page ID / Instagram account ID
  senderId: externalId, // PSID / IGSID
};

// ── GET /n8n/leads/context ──
export const LeadContextQuerySchema = z.strictObject({
  ...leadKey,
  // query strings are always strings, so the number is coerced
  historyLimit: z.coerce
    .number()
    .int()
    .min(1)
    .max(HISTORY_LIMIT_MAX)
    .default(HISTORY_LIMIT_DEFAULT),
});

/**
 * Optional text that never erases a stored value: `null`, a missing key and "" all mean "keep".
 * Trimmed, and NUL characters are stripped so Postgres never rejects the save.
 */
const keepIfEmpty = (max: number) =>
  storableText(max, { allowEmpty: true }).nullish();

/** ISO 3166-1 alpha-2, stored upper-case; "" or `null` keeps the stored value. */
const country = z
  .string()
  .trim()
  .regex(/^([A-Za-z]{2})?$/, 'Must be a 2-letter country code')
  .transform((c) => c.toUpperCase())
  .nullish();

const fieldKey = z
  .string()
  .min(1)
  .max(LEAD_FIELD_KEY_MAX)
  .refine((k) => !k.includes('\u0000'), 'Contains an invalid character');

/** A flat map of texts. An empty value is ignored by the merge: it never erases. */
export const LeadFieldsInputSchema = z
  .record(fieldKey, storableText(LEAD_FIELD_VALUE_MAX, { allowEmpty: true }))
  .refine(
    (fields) => Object.keys(fields).length <= LEAD_FIELDS_MAX_PER_REQUEST,
    `At most ${LEAD_FIELDS_MAX_PER_REQUEST} fields`,
  );

// ── POST /n8n/leads ──
export const UpsertLeadSchema = z.strictObject({
  ...leadKey,
  stage: storableText(50), // free text: stages differ per client
  phone: keepIfEmpty(30),
  country,
  lastIntent: keepIfEmpty(50),
  summary: keepIfEmpty(1000),
  fields: LeadFieldsInputSchema.default({}),
  claimNotification: z.boolean().default(false),
});

// ── Response shapes: they document the API (OpenAPI), nothing validates with them ──
export const LeadRecordSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  platform: z.enum(['FACEBOOK', 'INSTAGRAM']),
  accountId: z.string(),
  senderId: z.string(),
  stage: z.string(),
  phone: z.string().nullable(),
  country: z.string().nullable(),
  lastIntent: z.string().nullable(),
  summary: z.string().nullable(),
  fields: z.record(z.string(), z.string()),
  notifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const LeadHistoryItemSchema = z.object({
  message: z.string(),
  reply: z.string(), // "" when answered is false
  answered: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const LeadContextSchema = z.object({
  lead: LeadRecordSchema.nullable(),
  history: z.array(LeadHistoryItemSchema),
});

export const UpsertLeadResultSchema = z.object({
  lead: LeadRecordSchema,
  notifiedNow: z.boolean(),
});

export class LeadContextQueryDto extends createZodDto(LeadContextQuerySchema) {}
export class UpsertLeadDto extends createZodDto(UpsertLeadSchema) {}
export class LeadContextDto extends createZodDto(LeadContextSchema) {}
export class UpsertLeadResultDto extends createZodDto(UpsertLeadResultSchema) {}

export type LeadContextQuery = z.infer<typeof LeadContextQuerySchema>;
export type UpsertLeadInput = z.infer<typeof UpsertLeadSchema>;
