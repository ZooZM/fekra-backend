// clients/schemas/query-client.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';

export const QueryClientSchema = listQuery(
  ['name', 'businessCategory', 'createdAt'],
  'createdAt',
);
export type QueryClientInput = z.infer<typeof QueryClientSchema>;
export class QueryClientDto extends createZodDto(QueryClientSchema) {}
