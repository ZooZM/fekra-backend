// clients/schemas/json-columns.schema.ts
import { z } from 'zod';
import { httpUrl, replies, text } from '../../common/zod/primitives';

// aiConfig: only `language` is decided. looseObject keeps unknown keys until you add them here,
// then switch to z.strictObject.
export const AiConfigSchema = z
  .object({
    language: z.enum(['ENGLISH', 'ARABIC', 'ENGLISH_ARABIC']),
    brandVoice: z.string().trim().max(400).optional(),
  })
  .catchall(z.json());

export const DmReplyConfigSchema = z.strictObject({
  enabled: z.boolean(),
  likes_enabled: z.boolean(),
  replies,
});

export const CommentReplyConfigSchema = z.strictObject({
  enabled: z.boolean(),
  likes_enabled: z.boolean(),
  inquiry_can_dm: replies,
  inquiry_can_not_dm: replies,
  engagement: replies,
});

export const SocialMediaSchema = z
  .array(z.strictObject({ platform: text(50), url: httpUrl }))
  .max(20)
  .refine(
    (l) => new Set(l.map((s) => s.platform.toLowerCase())).size === l.length,
    'Each platform can appear only once',
  );

export const LocationSchema = z.strictObject({
  city: text(100),
  district: text(100),
  full_address: text(500),
  links: z
    .array(
      z.strictObject({ url: httpUrl, description: z.string().trim().max(255) }),
    )
    .max(10),
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
const day = z.strictObject({ startTime: time, endTime: time });

// a missing day means closed
export const WorkHoursSchema = z.strictObject({
  sunday: day.optional(),
  monday: day.optional(),
  tuesday: day.optional(),
  wednesday: day.optional(),
  thursday: day.optional(),
  friday: day.optional(),
  saturday: day.optional(),
});

// Service.variants: shape varies per service, names unique within a service
export const VariantsSchema = z
  .array(
    z.looseObject({
      name: text(255),
      price: z.string().trim().max(255).optional(),
      description: z.string().trim().max(1000).optional(),
    }),
  )
  .max(50)
  .refine(
    (l) => new Set(l.map((v) => v.name.toLowerCase())).size === l.length,
    'Variant names must be unique',
  );

export type AiConfig = z.infer<typeof AiConfigSchema>;
export type DmReplyConfig = z.infer<typeof DmReplyConfigSchema>;
export type CommentReplyConfig = z.infer<typeof CommentReplyConfigSchema>;
export type SocialMedia = z.infer<typeof SocialMediaSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type WorkHours = z.infer<typeof WorkHoursSchema>;
export type Variants = z.infer<typeof VariantsSchema>;
