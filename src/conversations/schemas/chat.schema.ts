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
export const QueryChatSchema = listQuery(
  ['createdAt', 'updatedAt'],
  'updatedAt',
).extend({
  clientId: z.uuid().optional(), // admins only. Scope CLIENT users from their JWT in the service
  platform: platformField.optional(),
  senderId: externalId.optional(),
  receiverId: externalId.optional(),
  // true = only chats whose assistant is paused now, false = only active ones
  paused: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

// ── Route params: /chats/:chatId/messages ──
export const ChatIdParamSchema = z.strictObject({ chatId: z.uuid() });

// ── Pause: POST /chats/:chatId/pause ──
export const PauseChatSchema = z.strictObject({
  duration: z.enum(['until_resumed', '1h', '24h', '7d']),
});

// ── Response shapes: they document the API (OpenAPI), nothing validates with them ──
export const LastExchangeSchema = z.object({
  message: z.string(),
  reply: z.string(),
  answered: z.boolean(),
  createdAt: z.iso.datetime(),
});

export const ChatRecordSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  clientName: z.string(),
  platform: z.enum(['FACEBOOK', 'INSTAGRAM']),
  senderId: z.string(),
  receiverId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  paused: z.boolean(),
  pausedAt: z.iso.datetime().nullable(),
  pausedUntil: z.iso.datetime().nullable(),
  pausedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  lastExchange: LastExchangeSchema.nullable(),
});

export const ChatPageSchema = z.object({
  data: z.array(ChatRecordSchema),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export class QueryChatDto extends createZodDto(QueryChatSchema) {}
export class PauseChatDto extends createZodDto(PauseChatSchema) {}
export class ChatRecordDto extends createZodDto(ChatRecordSchema) {}
export class ChatPageDto extends createZodDto(ChatPageSchema) {}
export class ChatIdParamDto extends createZodDto(ChatIdParamSchema) {}

export type FindOrCreateChatInput = z.infer<typeof FindOrCreateChatSchema>;
export type QueryChatInput = z.infer<typeof QueryChatSchema>;
export type PauseChatInput = z.infer<typeof PauseChatSchema>;
