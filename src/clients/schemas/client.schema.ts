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

// One path segment, added to N8N_BASE_URL. No slash, dot, space, @, ?, # or %, so nothing stored
// here can change the host or add a query (FR-035).
export const CHAT_ENDPOINT_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
export const chatWorkflowEndpoint = z
  .string()
  .trim()
  .regex(
    CHAT_ENDPOINT_PATTERN,
    'Use letters, digits, - and _ only (up to 100 characters)',
  );

// Zod 4 cannot .partial() a refined object, so the fields live here and each schema adds its rules
const ClientFields = z.strictObject({
  name: text(255),
  businessCategory: text(255),
  fbPageId: metaId.nullish(),
  instaAccountId: metaId.nullish(),
  accessToken: z.string().trim().min(1), // plaintext in, encrypted by the service before saving
  brandLogo: httpUrl.max(255).nullish(), // brand_logo is VARCHAR(255)
  aiConfig: AiConfigSchema.optional(),
  dmReplyConfig: DmReplyConfigInputSchema.optional(),
  commentReplyConfig: CommentReplyConfigSchema.optional(),
  chatWorkflowEndpoint: chatWorkflowEndpoint.nullish(),
  chatSubscribed: z.boolean().optional(),
});

// Subscribing needs an endpoint. On an edit the service checks the merged state instead, because
// the endpoint may already be stored.
export const CreateClientSchema = ClientFields.superRefine((client, ctx) => {
  if (client.chatSubscribed && !client.chatWorkflowEndpoint) {
    ctx.addIssue({
      code: 'custom',
      path: ['chatWorkflowEndpoint'],
      message:
        'Enter an endpoint before subscribing the client to the chat service',
    });
  }
});

/**
 * Edits never carry the token (it has its own endpoint) and must say which version they
 * started from, so a stale save is refused instead of overwriting someone else's change.
 */
export const UpdateClientSchema = ClientFields.omit({ accessToken: true })
  .partial()
  .extend({ version: z.number().int().min(1) });

export class CreateClientDto extends createZodDto(CreateClientSchema) {}
export class UpdateClientDto extends createZodDto(UpdateClientSchema) {}

export type CreateClientInput = z.infer<typeof CreateClientSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
