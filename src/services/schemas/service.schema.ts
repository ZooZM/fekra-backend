// clients/schemas/service.schema.ts
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { text } from '../../common/zod/primitives';
import { VariantsSchema } from '@common/zod/json-columns.schema';

export const CreateServiceSchema = z.strictObject({
  clientId: z.uuid(),
  name: text(255),
  description: z.string().trim().max(255).nullish(),
  price: z.string().trim().max(255).nullish(),
  offerId: z.uuid().nullish(),
  variants: VariantsSchema.nullish(),
});

export const UpdateServiceSchema = CreateServiceSchema.partial();

export type CreateServiceInput = z.infer<typeof CreateServiceSchema>;
export type UpdateServiceInput = z.infer<typeof UpdateServiceSchema>;

export class CreateServiceDto extends createZodDto(CreateServiceSchema) {}
export class UpdateServiceDto extends createZodDto(UpdateServiceSchema) {}
