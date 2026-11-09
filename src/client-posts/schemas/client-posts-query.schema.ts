// client-posts/schemas/client-posts-query.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { graphCursor, metaPostId } from '@common/zod/primitives';

export const PlatformSchema = z.enum(['facebook', 'instagram']);

/** Graph pages with cursors and gives no totals, so this is not the `page`/`limit` list query. */
export const ClientPostsQuerySchema = z.strictObject({
  platform: PlatformSchema,
  /** `meta.nextCursor` of the previous page. */
  after: graphCursor.optional(),
  limit: z.coerce.number().int().min(1).max(25).default(25),
});

export const UnrepliedCountQuerySchema = z.strictObject({
  platform: PlatformSchema,
});

export const ClientPostParamsSchema = z.strictObject({
  id: z.uuid(),
  postId: metaPostId,
});

export type ClientPostsQueryInput = z.infer<typeof ClientPostsQuerySchema>;
export type UnrepliedCountQueryInput = z.infer<
  typeof UnrepliedCountQuerySchema
>;
export type ClientPostParamsInput = z.infer<typeof ClientPostParamsSchema>;

export class ClientPostsQueryDto extends createZodDto(ClientPostsQuerySchema) {}
export class UnrepliedCountQueryDto extends createZodDto(
  UnrepliedCountQuerySchema,
) {}
export class ClientPostParamsDto extends createZodDto(ClientPostParamsSchema) {}
