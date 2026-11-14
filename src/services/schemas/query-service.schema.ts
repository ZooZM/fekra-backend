import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';

export const QueryServiceSchema = listQuery(
  ['name', 'price', 'createdAt'],
  'createdAt',
).extend({
  // the dashboard lists one client's services at a time
  clientId: z.uuid().optional(),
});

export type QueryServiceInput = z.infer<typeof QueryServiceSchema>;

export class QueryServiceDto extends createZodDto(QueryServiceSchema) {}
