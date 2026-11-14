import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';
import {
  classificationField,
  decisionBasisField,
  platformField,
} from '@common/zod/meta-fields';
import {
  dateRangeFields,
  externalId,
  RANGE_ERROR,
  rangeIsOrdered,
  storableText,
} from '@common/zod/storage-fields';

export const MAX_COMMENT_LENGTH = 8_000; // Facebook's limit (Instagram's is 2,200)
export const MAX_REASON_LENGTH = 1_000;

// ── Write: a classified comment. Use it as the `create` branch of the upsert ──
export const SaveCommentReplySchema = z.strictObject({
  clientId: z.uuid(),
  platform: platformField,
  commentId: externalId,
  // Empty is valid: a sticker or GIF comment has no text, and the classifier calls it engagement
  comment: storableText(MAX_COMMENT_LENGTH, { allowEmpty: true }),
  classification: classificationField, // accepts 'inquiry' or 'INQUIRY', outputs 'INQUIRY'
  reason: storableText(MAX_REASON_LENGTH),
  // How the label was decided. UNKNOWN is only for rows from before it was recorded.
  decisionBasis: z
    .enum(['RULES', 'AI_MODEL', 'SAFE_FALLBACK', 'UNKNOWN'])
    .default('UNKNOWN'),
  decisionModel: z.string().trim().min(1).max(100).nullish(),
});

// The `update` branch of the upsert: the label, the reason and how it was decided can change
export const ReclassifyCommentSchema = SaveCommentReplySchema.pick({
  classification: true,
  reason: true,
  decisionBasis: true,
  decisionModel: true,
});

// ── Read: GET /comment-replies ──
export const QueryCommentReplySchema = listQuery(['createdAt'], 'createdAt')
  .extend({
    clientId: z.uuid().optional(), // admins only. Scope CLIENT users from their JWT in the service
    platform: platformField.optional(),
    classification: classificationField.optional(),
    decisionBasis: decisionBasisField.optional(),
    commentId: externalId.optional(),
    ...dateRangeFields,
  })
  .refine(rangeIsOrdered, RANGE_ERROR);

// ── Read: GET /comment-replies/export. The list's filters, with no paging and no order ──
export const ExportCommentsQuerySchema = z
  .strictObject({
    clientId: z.uuid().optional(), // admins only; the route is ADMIN-only anyway
    platform: platformField.optional(),
    classification: classificationField.optional(),
    decisionBasis: decisionBasisField.optional(),
    ...dateRangeFields,
  })
  .refine(rangeIsOrdered, RANGE_ERROR);

// ── Response shapes: they document the API (OpenAPI), nothing validates with them ──
export const CommentRecordSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  clientName: z.string(),
  platform: z.enum(['FACEBOOK', 'INSTAGRAM']),
  commentId: z.string(),
  comment: z.string(),
  classification: z.enum([
    'ENGAGEMENT',
    'INQUIRY',
    'UNSURE',
    'COMPLAINT',
    'SPAM',
    'INSULT',
  ]),
  reason: z.string(),
  decisionBasis: z.enum(['RULES', 'AI_MODEL', 'SAFE_FALLBACK', 'UNKNOWN']),
  decisionModel: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const CommentPageSchema = z.object({
  data: z.array(CommentRecordSchema),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export class QueryCommentReplyDto extends createZodDto(
  QueryCommentReplySchema,
) {}
export class ExportCommentsQueryDto extends createZodDto(
  ExportCommentsQuerySchema,
) {}
export class CommentPageDto extends createZodDto(CommentPageSchema) {}

export type SaveCommentReplyInput = z.infer<typeof SaveCommentReplySchema>;
export type ReclassifyCommentInput = z.infer<typeof ReclassifyCommentSchema>;
export type QueryCommentReplyInput = z.infer<typeof QueryCommentReplySchema>;
export type ExportCommentsQueryInput = z.infer<
  typeof ExportCommentsQuerySchema
>;
