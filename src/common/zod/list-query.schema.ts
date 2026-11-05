// common/zod/list-query.schema.ts
import { z } from 'zod';

/** Pagination and ordering shared by every list endpoint. */
export function listQuery<const T extends readonly [string, ...string[]]>(
  orderFields: T,
  defaultOrderBy: T[number],
) {
  return z.strictObject({
    // query strings are always strings, so numbers are coerced
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    orderBy: z.enum(orderFields).default(defaultOrderBy),
    orderDir: z.enum(['asc', 'desc']).default('desc'),
  });
}

export type BaseListQuery = {
  page: number;
  limit: number;
  orderBy: string;
  orderDir: 'asc' | 'desc';
};
