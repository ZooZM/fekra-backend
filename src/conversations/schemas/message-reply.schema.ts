import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { listQuery } from '@common/zod/list-query.schema';
import {
  dateRangeFields,
  RANGE_ERROR,
  rangeIsOrdered,
  storableText,
} from '@common/zod/storage-fields';

export const MAX_MESSAGE_LENGTH = 40_000; // a batch of up to 20 buffered messages x 2,000 characters
export const MAX_REPLY_LENGTH = 10_000;

// ── Write: a customer message (or batch) and the reply that was sent ──
export const CreateMessageReplySchema = z.strictObject({
  chatId: z.uuid(),
  message: storableText(MAX_MESSAGE_LENGTH),
  reply: storableText(MAX_REPLY_LENGTH),
});

// ── Read: GET /chats/:chatId/messages (chatId comes from the route) ──
// Newest first by default. Pass orderDir=asc to read a conversation top to bottom.
export const QueryMessageReplySchema = listQuery(['createdAt'], 'createdAt')
  .extend({ ...dateRangeFields })
  .refine(rangeIsOrdered, RANGE_ERROR);

export class QueryMessageReplyDto extends createZodDto(QueryMessageReplySchema) {}

export type CreateMessageReplyInput = z.infer<typeof CreateMessageReplySchema>;
export type QueryMessageReplyInput = z.infer<typeof QueryMessageReplySchema>;
