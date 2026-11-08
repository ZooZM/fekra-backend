// clients/schemas/client-record.schema.ts
// Response shapes. They document the API (OpenAPI) and give the dashboard its types; they are
// not used to validate anything. They never include the access token.
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  AiConfigSchema,
  CommentReplyConfigSchema,
  DmReplyConfigSchema,
} from '@common/zod/json-columns.schema';

export const ClientRecordSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  businessCategory: z.string(),
  fbPageId: z.string().nullable(),
  instaAccountId: z.string().nullable(),
  brandLogo: z.string().nullable(),
  aiConfig: AiConfigSchema,
  dmReplyConfig: DmReplyConfigSchema,
  commentReplyConfig: CommentReplyConfigSchema,
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const PaginatedClientsSchema = z.object({
  data: z.array(ClientRecordSchema),
  meta: z.object({
    total: z.number().int(),
    page: z.number().int(),
    limit: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export class ClientRecordDto extends createZodDto(ClientRecordSchema) {}
export class PaginatedClientsDto extends createZodDto(PaginatedClientsSchema) {}
