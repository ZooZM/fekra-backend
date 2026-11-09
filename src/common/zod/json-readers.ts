// clients/schemas/json-readers.ts
import { Logger } from '@nestjs/common';
import { z } from 'zod';
import * as S from './json-columns.schema';

const logger = new Logger('JsonColumns');

function reader<T>(name: string, schema: z.ZodType<T>, fallback: T) {
  return (value: unknown): T => {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    logger.warn(
      `Invalid ${name} in database, using fallback: ${result.error.issues[0]?.message}`,
    );
    return fallback;
  };
}

export const readAiConfig = reader('aiConfig', S.AiConfigSchema, {
  language: 'ARABIC',
});
export const readDmConfig = reader('dmReplyConfig', S.DmReplyConfigSchema, {
  enabled: false,
  likes_enabled: false,
  replies: [],
});
export const readCommentConfig = reader(
  'commentReplyConfig',
  S.CommentReplyConfigSchema,
  {
    enabled: false,
    likes_enabled: false,
    inquiry_can_dm: [],
    inquiry_can_not_dm: [],
    engagement: [],
  },
);
export const readSocialMedia = reader('socialMedia', S.SocialMediaSchema, []);
export const readVariants = reader('variants', S.VariantsSchema, []);

// nullable columns: null means "not set"
export const readLocation = (v: unknown) =>
  v == null ? null : reader('location', S.LocationSchema.nullable(), null)(v);
export const readWorkHours = (v: unknown) =>
  v == null ? null : reader('workHours', S.WorkHoursSchema.nullable(), null)(v);

/** `ClientActivity.details`: null for actions that carry none, and for stored JSON that doesn't match. */
export const readReplyRunDetails = reader(
  'activity details',
  S.ReplyRunActivityDetailsSchema.nullable(),
  null,
);
