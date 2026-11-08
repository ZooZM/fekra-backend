// clients/schemas/client.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { httpUrl, metaId, text } from '../../common/zod/primitives';
import {
  AiConfigSchema,
  CommentReplyConfigSchema,
  DmReplyConfigSchema,
} from '@common/zod/json-columns.schema';

// private messages switched on with nothing to send is a mistake; the stored/read shape
// (DmReplyConfigSchema) stays lenient so existing rows keep loading
export const DmReplyConfigInputSchema = DmReplyConfigSchema.refine(
  (c) => !c.enabled || c.replies.length > 0,
  {
    message: 'Add at least one message when private messages are on',
    path: ['replies'],
  },
);

export const CreateClientSchema = z.strictObject({
  name: text(255),
  businessCategory: text(255),
  fbPageId: metaId.nullish(),
  instaAccountId: metaId.nullish(),
  accessToken: z.string().trim().min(1), // plaintext in, encrypted by the service before saving
  brandLogo: httpUrl.max(255).nullish(), // brand_logo is VARCHAR(255)
  aiConfig: AiConfigSchema.optional(),
  dmReplyConfig: DmReplyConfigInputSchema.optional(),
  commentReplyConfig: CommentReplyConfigSchema.optional(),
});

/**
 * Edits never carry the token (it has its own endpoint) and must say which version they
 * started from, so a stale save is refused instead of overwriting someone else's change.
 */
export const UpdateClientSchema = CreateClientSchema.omit({ accessToken: true })
  .partial()
  .extend({ version: z.number().int().min(1) });

export class CreateClientDto extends createZodDto(CreateClientSchema) {}
export class UpdateClientDto extends createZodDto(UpdateClientSchema) {}

export type CreateClientInput = z.infer<typeof CreateClientSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
