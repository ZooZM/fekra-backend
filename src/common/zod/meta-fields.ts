import { z } from 'zod';
import type {
  CommentClassification,
  Platform,
} from '@app/generated/prisma/client';

// The pipeline and n8n use lowercase ('facebook', 'inquiry'); the database enums are uppercase.
// Both fields accept either case and always output the database enum value.
// `satisfies Record<Lowercase<...>, ...>` fails to compile if an enum value is added and not mapped here.

const PLATFORMS = {
  facebook: 'FACEBOOK',
  instagram: 'INSTAGRAM',
} as const satisfies Record<Lowercase<Platform>, Platform>;

export const platformField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.enum(['facebook', 'instagram']))
  .transform((p) => PLATFORMS[p]);

const CLASSIFICATIONS = {
  engagement: 'ENGAGEMENT',
  inquiry: 'INQUIRY',
  unsure: 'UNSURE',
  complaint: 'COMPLAINT',
  spam: 'SPAM',
  insult: 'INSULT',
} as const satisfies Record<
  Lowercase<CommentClassification>,
  CommentClassification
>;

export const classificationField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z.enum(['engagement', 'inquiry', 'unsure', 'complaint', 'spam', 'insult']),
  )
  .transform((c) => CLASSIFICATIONS[c]);
