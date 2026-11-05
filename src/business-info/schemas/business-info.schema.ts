// clients/schemas/business-info.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { httpUrl, uniqueStrings } from '@common/zod/primitives';
import {
  LocationSchema,
  SocialMediaSchema,
  WorkHoursSchema,
} from '@common/zod/json-columns.schema';

// Single definition of the fields. Both schemas below are derived from it.
const BusinessInfoFields = z.strictObject({
  phone: z.string().trim().max(50).nullish(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(255)).nullish(),
  whatsapp: z.string().trim().max(50).nullish(),
  website: httpUrl.nullish(),
  socialMedia: SocialMediaSchema,
  location: LocationSchema.nullish(),
  workHours: WorkHoursSchema.nullish(),
  paymentMethods: uniqueStrings(),
  installmentOptions: uniqueStrings(),
});

// ── Create ──
// clientId comes from the route or the authenticated user, not the body.
// Arrays default to [] (matching the Prisma defaults); everything else is optional.
export const CreateBusinessInfoSchema = BusinessInfoFields.extend({
  clientId: z.uuid(),
  socialMedia: SocialMediaSchema.default([]),
  paymentMethods: uniqueStrings().default([]),
  installmentOptions: uniqueStrings().default([]),
});

// ── Update ──
// Every field optional, no defaults: a field that isn't sent stays unchanged.
// null on a nullable field clears it.
export const UpdateBusinessInfoSchema = BusinessInfoFields.partial().refine(
  (v) => Object.keys(v).length > 0,
  'At least one field is required',
);

export class CreateBusinessInfoDto extends createZodDto(
  CreateBusinessInfoSchema,
) {}
export class UpdateBusinessInfoDto extends createZodDto(
  UpdateBusinessInfoSchema,
) {}

export type CreateBusinessInfoInput = z.infer<typeof CreateBusinessInfoSchema>;
export type UpdateBusinessInfoInput = z.infer<typeof UpdateBusinessInfoSchema>;
