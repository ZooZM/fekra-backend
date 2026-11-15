// common/zod/primitives.ts
import { z } from 'zod';

export const text = (max = 255) => z.string().trim().min(1).max(max);
export const httpUrl = z.url({ protocol: /^https?$/ }).max(500); // rejects javascript:, ftp:, etc.
export const metaId = z
  .string()
  .trim()
  .regex(/^\d{5,30}$/, 'Must be a numeric Meta ID');
/** Facebook post id (`{pageId}_{postId}` or the object id) or Instagram media id. */
export const metaPostId = z
  .string()
  .trim()
  .regex(/^\d{5,30}(_\d{5,30})?$/, 'Must be a Meta post or media ID');
/** A Graph API paging cursor. Restricted to the base64url alphabet so it can't alter the request URL. */
export const graphCursor = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9_\-=]+$/, 'Invalid cursor');
export const replies = z.array(text(1000)).max(50);
export const uniqueStrings = (max = 50) =>
  z
    .array(text(max))
    .max(20)
    .refine(
      (l) => new Set(l.map((s) => s.toLowerCase())).size === l.length,
      'Duplicates are not allowed',
    );

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(255));
export const passwordField = z.string().min(8).max(72); // bcrypt ignores everything after 72 bytes; never trim
export const nameField = z.string().trim().min(1).max(100);
export const IdParamSchema = z.strictObject({ id: z.uuid() });
export const ClientIdParamSchema = z.strictObject({ clientId: z.uuid() });
