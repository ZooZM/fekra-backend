import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';

export const QueryServiceSchema = listQuery(
  ['name', 'price', 'createdAt'],
  'createdAt',
);

export type QueryServiceInput = z.infer<typeof QueryServiceSchema>;

export class QueryServiceDto extends createZodDto(QueryServiceSchema) {}
