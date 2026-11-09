import { z } from 'zod';

/**
 * An id issued by Meta: a customer id, a page id, a comment id.
 * Not numeric-only: Facebook comment ids look like "123_456", and the simulators use short ids.
 * Swap in the numeric `metaId` primitive if you only ever want real ids.
 */
export const externalId = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[\w.:-]+$/, 'Contains invalid characters');

/**
 * Customer-written text that goes into a Text column.
 * Postgres rejects the NUL character, which would fail the whole insert, so it is stripped
 * (rejecting would lose the customer's message). Length is checked after trimming.
 */
export function storableText(
  max: number,
  options: { allowEmpty?: boolean } = {},
) {
  return z
    .string()
    .transform((s) => s.split('\u0000').join('').trim())
    .pipe(
      z
        .string()
        .min(options.allowEmpty ? 0 : 1)
        .max(max),
    );
}

/** A query-string date: '2026-11-01' or '2026-11-01T10:00:00Z', parsed to a Date. */
export const instant = z
  .union([z.iso.datetime({ offset: true }), z.iso.date()])
  .pipe(z.coerce.date());

/** Spread into a query schema's .extend(), then finish with .refine(rangeIsOrdered, RANGE_ERROR). */
export const dateRangeFields = {
  from: instant.optional(),
  to: instant.optional(),
};

export const rangeIsOrdered = (q: { from?: Date; to?: Date }) =>
  !q.from || !q.to || q.from <= q.to;

export const RANGE_ERROR = {
  path: ['to'],
  message: 'to must not be before from',
};
