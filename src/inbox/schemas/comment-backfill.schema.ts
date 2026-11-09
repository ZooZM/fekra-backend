// inbox/schemas/comment-backfill.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { metaId, metaPostId } from '@common/zod/primitives';

export const CommentBackfillSchema = z.strictObject({
  /** Facebook Page ID or Instagram account ID; the platform is taken from the client that owns it. */
  accountId: metaId,
  /** Facebook post ID (`{pageId}_{postId}` or the object ID) or Instagram media ID. */
  postId: metaPostId,
});

export type CommentBackfillInput = z.infer<typeof CommentBackfillSchema>;
export class CommentBackfillDto extends createZodDto(CommentBackfillSchema) {}

// ─────────────────────────── responses ───────────────────────────
// They document the API (OpenAPI) and give the dashboard its types; they are not used to
// validate anything. They hold no token and no email.

export const BackfillRunStateSchema = z.enum([
  'running',
  'finished',
  'stopped',
  'interrupted',
]);

/** Why a run ended as `interrupted`. */
export const InterruptReasonSchema = z.enum([
  'SERVER_RESTART',
  'COMMENT_REPLIES_DISABLED',
  'ACCOUNT_DISCONNECTED',
  'META_ACCESS_LOST',
]);

export const ActorRefSchema = z.object({ id: z.uuid(), name: z.string() });

export const BackfillRunSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  accountId: z.string(),
  platform: z.enum(['facebook', 'instagram']),
  postId: z.string(),
  state: BackfillRunStateSchema,
  interruptReason: InterruptReasonSchema.nullable(),
  /** Comments checked when the run started. */
  total: z.number().int().min(0),
  /** Unreplied comments when the run started: N in "handled X of N". */
  toAnswer: z.number().int().min(1),
  /** queued + dropped + skipped. */
  handled: z.number().int().min(0),
  /** Accepted by the inbox: the normal comment flow answers, likes or hides them. */
  queued: z.number().int().min(0),
  /** Refused by the inbox: a duplicate, or a blocked sender. */
  dropped: z.number().int().min(0),
  /** Answered, hidden or deleted since the run started, or the re-check failed. */
  skipped: z.number().int().min(0),
  delaySeconds: z.number(),
  startedAt: z.iso.datetime(),
  estimatedEndAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  startedBy: ActorRefSchema,
  stoppedBy: ActorRefSchema.nullable(),
});

export const BackfillStartResultSchema = z.object({
  platform: z.enum(['facebook', 'instagram']),
  postId: z.string(),
  /** Top-level comments on the post (up to the configured maximum). */
  total: z.number().int().min(0),
  /** Comments the page hasn't replied to. Same as `run.toAnswer`; 0 when there is nothing to answer. */
  pending: z.number().int().min(0),
  /** Seconds between two comments, to avoid Meta's spam limits. */
  delaySeconds: z.number(),
  /** The run that was started. Null when `pending` is 0: nothing starts and nothing is recorded. */
  run: BackfillRunSchema.nullable(),
});

export type BackfillRunState = z.infer<typeof BackfillRunStateSchema>;
export type InterruptReason = z.infer<typeof InterruptReasonSchema>;
export type BackfillRun = z.infer<typeof BackfillRunSchema>;
export type BackfillStartResult = z.infer<typeof BackfillStartResultSchema>;

export class BackfillRunDto extends createZodDto(BackfillRunSchema) {}
export class BackfillStartResultDto extends createZodDto(
  BackfillStartResultSchema,
) {}
