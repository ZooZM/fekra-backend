// clients/schemas/offer.schema.ts
import { z } from 'zod';
import { text } from '../../common/zod/primitives';
import { createZodDto } from 'nestjs-zod';

// 'YYYY-MM-DD' in, Date out (the columns are @db.Date)
const date = z.iso.date().transform((s) => new Date(s));

const OfferBase = z.strictObject({
  clientId: z.uuid(),
  title: text(255),
  description: z.string().trim().max(255).nullish(),
  discountType: z.enum(['PERCENTAGE', 'FIXED_AMOUNT']),
  discountValue: z.number().positive().max(99_999_999.99), // Decimal(10,2)
  startDate: date,
  endDate: date,
});

type OfferFields = Partial<z.infer<typeof OfferBase>>;

// Object-level rules go last: Zod 4 won't let you .partial() a refined object,
// so the update schema derives from OfferBase and re-applies them.
const offerRules = (o: OfferFields, ctx: z.RefinementCtx) => {
  if (o.startDate && o.endDate && o.endDate < o.startDate) {
    ctx.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'endDate must not be before startDate',
    });
  }
  if (
    o.discountType === 'PERCENTAGE' &&
    o.discountValue !== undefined &&
    o.discountValue > 100
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountValue'],
      message: 'A percentage cannot exceed 100',
    });
  }
};

export const CreateOfferSchema = OfferBase.superRefine(offerRules);
export const UpdateOfferSchema = OfferBase.partial().superRefine(offerRules);

export type CreateOfferInput = z.infer<typeof CreateOfferSchema>;
export type UpdateOfferInput = z.infer<typeof UpdateOfferSchema>;

export class CreateOfferDto extends createZodDto(CreateOfferSchema) {}
export class UpdateOfferDto extends createZodDto(UpdateOfferSchema) {}
