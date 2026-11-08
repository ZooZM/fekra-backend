import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReplaceAccessTokenSchema = z.strictObject({
  token: z.string().trim().min(1).max(4096),
});

export class ReplaceAccessTokenDto extends createZodDto(
  ReplaceAccessTokenSchema,
) {}
export type ReplaceAccessTokenInput = z.infer<typeof ReplaceAccessTokenSchema>;
