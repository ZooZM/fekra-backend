// clients/schemas/client.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { httpUrl, metaId, text } from '../../common/zod/primitives';
import {
  AiConfigSchema,
  CommentReplyConfigSchema,
  DmReplyConfigSchema,
} from '@common/zod/json-columns.schema';

export const CreateClientSchema = z.strictObject({
  name: text(255),
  businessCategory: text(255),
  fbPageId: metaId.nullish(),
  instaAccountId: metaId.nullish(),
  accessToken: z.string().trim().min(1), // plaintext in, encrypted by the service before saving
  brandLogo: httpUrl.nullish(),
  aiConfig: AiConfigSchema.optional(),
  dmReplyConfig: DmReplyConfigSchema.optional(),
  commentReplyConfig: CommentReplyConfigSchema.optional(),
});

export const UpdateClientSchema = CreateClientSchema.partial();

export class CreateClientDto extends createZodDto(CreateClientSchema) {}
export class UpdateClientDto extends createZodDto(UpdateClientSchema) {}

export type CreateClientInput = z.infer<typeof CreateClientSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
