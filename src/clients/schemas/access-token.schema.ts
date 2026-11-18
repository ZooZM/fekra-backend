import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** A Meta access token as typed by an admin: plaintext, encrypted by the service before saving. */
export const metaAccessToken = z.string().trim().min(1).max(4096);

/** Body of PUT /clients/:id/access-token and PUT /clients/:id/instagram-access-token. */
export const ReplaceAccessTokenSchema = z.strictObject({
  token: metaAccessToken,
});

export class ReplaceAccessTokenDto extends createZodDto(
  ReplaceAccessTokenSchema,
) {}
export type ReplaceAccessTokenInput = z.infer<typeof ReplaceAccessTokenSchema>;
