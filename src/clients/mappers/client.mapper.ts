// clients/mappers/client.mapper.ts
import { Client, Prisma } from '@app/generated/prisma/client';
import {
  readAiConfig,
  readCommentConfig,
  readDmConfig,
  readVariants,
} from '@common/zod/json-readers';
import { toBusinessInfoRecord } from '@app/business-info/mappers/business-info.mapper'; // move toRecord out of BusinessInfoRepository
import {
  ClientAdminRecord,
  ClientRecord,
  ClientWorkflowData,
} from '../types/client.types';

export type ClientRow = Prisma.ClientGetPayload<{
  omit: { accessToken: true; instaAccessToken: true };
}>;
export type ClientWorkflowRow = Prisma.ClientGetPayload<{
  omit: { accessToken: true; instaAccessToken: true };
  include: { services: true; offers: true; businessInfo: true };
}>;

/**
 * Per-query `omit` that reads the token columns PrismaService hides, for toClientAdminRecord.
 * The generated types list the token columns even when they are omitted, so a query that
 * forgets this compiles but reports every token as missing.
 */
export const WITH_TOKENS = {
  accessToken: false,
  instaAccessToken: false,
} as const;

export function toClientRecord(row: ClientRow): ClientRecord {
  return {
    ...row,
    aiConfig: readAiConfig(row.aiConfig),
    dmReplyConfig: readDmConfig(row.dmReplyConfig),
    commentReplyConfig: readCommentConfig(row.commentReplyConfig),
  };
}

/** A row read with WITH_TOKENS. The encrypted tokens are dropped here: only whether each is set goes on. */
export function toClientAdminRecord(row: Client): ClientAdminRecord {
  const { accessToken, instaAccessToken, ...rest } = row;
  return {
    ...toClientRecord(rest),
    hasAccessToken: accessToken !== null,
    hasInstaAccessToken: instaAccessToken !== null,
  };
}

export function toWorkflowData(row: ClientWorkflowRow): ClientWorkflowData {
  const { services, offers, businessInfo, ...client } = row;
  return {
    ...toClientRecord(client),
    services: services.map((s) => ({
      ...s,
      variants: s.variants == null ? null : readVariants(s.variants),
    })),
    offers,
    businessInfo: businessInfo ? toBusinessInfoRecord(businessInfo) : null,
  };
}
