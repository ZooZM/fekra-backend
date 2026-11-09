// client-posts/schemas/client-post-record.schema.ts
// Response shapes. They document the API (OpenAPI) and give the dashboard its types; they are
// not used to validate anything. They never include the access token.
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { BackfillRunSchema } from '@app/inbox/schemas/comment-backfill.schema';
import { PlatformSchema } from './client-posts-query.schema';

export const ClientPostSchema = z.object({
  /** Facebook: `{pageId}_{postId}`. Instagram: the media id. */
  id: z.string(),
  platform: PlatformSchema,
  publishedAt: z.iso.datetime(),
  /** First 500 characters; null when the post has no text. */
  text: z.string().max(500).nullable(),
  textTruncated: z.boolean(),
  /** https only; null when the post has no image or video. */
  thumbnailUrl: z.string().nullable(),
  permalink: z.string(),
  /** For display only. On Instagram it includes replies. */
  commentsCount: z.number().int().min(0),
  /** The latest reply run on this post, while it runs and for 24 hours after it ends. */
  replyRun: BackfillRunSchema.nullable(),
});

export const ClientPostPageSchema = z.object({
  data: z.array(ClientPostSchema),
  meta: z.object({
    limit: z.number().int(),
    /** Pass as `after` to load the next page; null on the last page. */
    nextCursor: z.string().nullable(),
    fetchedAt: z.iso.datetime(),
  }),
});

export const UnrepliedCountSchema = z.object({
  postId: z.string(),
  platform: PlatformSchema,
  /** Top-level comments read, at most COMMENT_BACKFILL_MAX. */
  checked: z.number().int().min(0),
  unrepliedCount: z.number().int().min(0),
  /** True when the post has more comments than were read, so the count is a minimum. */
  truncated: z.boolean(),
  checkedAt: z.iso.datetime(),
});

export type ClientPost = z.infer<typeof ClientPostSchema>;
export type ClientPostPage = z.infer<typeof ClientPostPageSchema>;
export type UnrepliedCount = z.infer<typeof UnrepliedCountSchema>;

export class ClientPostPageDto extends createZodDto(ClientPostPageSchema) {}
export class UnrepliedCountDto extends createZodDto(UnrepliedCountSchema) {}
