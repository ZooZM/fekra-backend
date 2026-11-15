import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** An optional text from an n8n expression: an empty expression arrives as null or "". */
const optionalText = z.string().nullish();

/**
 * POST /n8n/callback (constitution II). It accepts exactly what the controller accepted before this
 * schema existed, because the live n8n workflows send it:
 * - loose on purpose (not strict): a workflow may add keys of its own, and they are ignored;
 * - the optional texts may be null or "": both mean "not sent" (the controller trims them);
 * - `type` "" or null means the default, engagement.
 * Only an invalid body changes: 422 INPUT_VALIDATION_ERROR instead of 400 (feature 004).
 */
export const N8nCallbackSchema = z.looseObject({
  id: z.string().min(1, 'id is required'), // the requestId the platform sent
  text: optionalText, // DM batch reply
  type: z // comments only
    .union([z.enum(['engagement', 'question']), z.literal(''), z.null()])
    .transform((type) => type || undefined)
    .optional(),
  publicReply: optionalText,
  dmText: optionalText,
  publicReplyIfDmSent: optionalText,
  publicReplyIfDmClosed: optionalText,
});

// ── Response (OpenAPI only) ──
export const N8nCallbackResultSchema = z.object({
  /** false: unknown, duplicate or expired id (nothing is sent). */
  acknowledged: z.boolean(),
});

export class N8nCallbackDto extends createZodDto(N8nCallbackSchema) {}
export class N8nCallbackResultDto extends createZodDto(
  N8nCallbackResultSchema,
) {}

export type N8nCallbackInput = z.infer<typeof N8nCallbackSchema>;
