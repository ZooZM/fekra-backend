import { Lead } from '@app/generated/prisma/client';
import { readLeadFields } from '@common/zod/json-readers';
import { LeadRecord } from '../types/lead.types';

/** Row → record. Stored JSON is never trusted: `fields` goes through its reader. */
export const toLeadRecord = (row: Lead): LeadRecord => ({
  ...row,
  fields: readLeadFields(row.fields),
});
