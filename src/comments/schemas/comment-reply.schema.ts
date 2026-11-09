import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';
import { classificationField, platformField } from '@common/zod/meta-fields';
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
});

// The `update` branch of the upsert: only the label and the reason can change
export const ReclassifyCommentSchema = SaveCommentReplySchema.pick({
  classification: true,
  reason: true,
});

// ── Read: GET /comment-replies ──
export const QueryCommentReplySchema = listQuery(['createdAt'], 'createdAt')
  .extend({
    clientId: z.uuid().optional(), // admins only. Scope CLIENT users from their JWT in the service
    platform: platformField.optional(),
    classification: classificationField.optional(),
    commentId: externalId.optional(),
    ...dateRangeFields,
  })
  .refine(rangeIsOrdered, RANGE_ERROR);

export class QueryCommentReplyDto extends createZodDto(
  QueryCommentReplySchema,
) {}

export type SaveCommentReplyInput = z.infer<typeof SaveCommentReplySchema>;
export type ReclassifyCommentInput = z.infer<typeof ReclassifyCommentSchema>;
export type QueryCommentReplyInput = z.infer<typeof QueryCommentReplySchema>;
