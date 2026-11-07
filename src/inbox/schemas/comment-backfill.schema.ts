// inbox/schemas/comment-backfill.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { metaId } from '@common/zod/primitives';

export const CommentBackfillSchema = z.strictObject({
  /** Facebook Page ID or Instagram account ID; the platform is taken from the client that owns it. */
  accountId: metaId,
  /** Facebook post ID (`{pageId}_{postId}` or the object ID) or Instagram media ID. */
  postId: z
    .string()
    .trim()
    .regex(/^\d{5,30}(_\d{5,30})?$/, 'Must be a Meta post or media ID'),
});

export type CommentBackfillInput = z.infer<typeof CommentBackfillSchema>;
export class CommentBackfillDto extends createZodDto(CommentBackfillSchema) {}
