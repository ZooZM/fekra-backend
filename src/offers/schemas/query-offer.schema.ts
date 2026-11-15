import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';

export const QueryOfferSchema = listQuery(
  ['title', 'startDate', 'endDate', 'createdAt'],
  'createdAt',
).extend({
  // the dashboard lists one client's offers at a time
  clientId: z.uuid().optional(),
});

export type QueryOfferInput = z.infer<typeof QueryOfferSchema>;

export class QueryOfferDto extends createZodDto(QueryOfferSchema) {}
