// clients/schemas/query-client.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';

export const QueryClientSchema = listQuery(
  ['name', 'businessCategory', 'createdAt'],
  'createdAt',
).extend({
  // case-insensitive partial match on name or business category (FR-007)
  search: z.string().trim().min(1).max(100).optional(),
  // false = the clients that still need to be subscribed to the chat service (the release checklist)
  chatSubscribed: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type QueryClientInput = z.infer<typeof QueryClientSchema>;
export class QueryClientDto extends createZodDto(QueryClientSchema) {}
