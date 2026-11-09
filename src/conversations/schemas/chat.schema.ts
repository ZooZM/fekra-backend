import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';
import { platformField } from '@common/zod/meta-fields';
import { externalId } from '@common/zod/storage-fields';

// ── Write: what the pipeline passes to find-or-create a chat ──
// Not a request body, so there is no DTO class. Call FindOrCreateChatSchema.parse(...) where the
// ids come in (the webhook handler), and pass the result to the repository.
export const FindOrCreateChatSchema = z
  .strictObject({
    clientId: z.uuid(),
    platform: platformField,
    senderId: externalId, // the customer
    receiverId: externalId, // the client's Page or Instagram account
  })
  .refine((c) => c.senderId !== c.receiverId, {
    path: ['senderId'],
    message: 'senderId and receiverId must be different',
  });

// ── Read: GET /chats ──
export const QueryChatSchema = listQuery(['createdAt', 'updatedAt'], 'updatedAt').extend({
  clientId: z.uuid().optional(), // admins only. Scope CLIENT users from their JWT in the service
  platform: platformField.optional(),
  senderId: externalId.optional(),
  receiverId: externalId.optional(),
});

// ── Route params: /chats/:chatId/messages ──
export const ChatIdParamSchema = z.strictObject({ chatId: z.uuid() });

export class QueryChatDto extends createZodDto(QueryChatSchema) {}
export class ChatIdParamDto extends createZodDto(ChatIdParamSchema) {}

export type FindOrCreateChatInput = z.infer<typeof FindOrCreateChatSchema>;
export type QueryChatInput = z.infer<typeof QueryChatSchema>;
