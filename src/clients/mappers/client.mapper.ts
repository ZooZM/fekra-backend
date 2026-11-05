// clients/mappers/client.mapper.ts
import { Prisma } from '@app/generated/prisma/client';
import {
  readAiConfig,
  readCommentConfig,
  readDmConfig,
  readVariants,
} from '@common/zod/json-readers';
import { toBusinessInfoRecord } from '@app/business-info/mappers/business-info.mapper'; // move toRecord out of BusinessInfoRepository
import { ClientRecord, ClientWorkflowData } from '../types/client.types';

export type ClientRow = Prisma.ClientGetPayload<{
  omit: { accessToken: true };
}>;
export type ClientWorkflowRow = Prisma.ClientGetPayload<{
  omit: { accessToken: true };
  include: { services: true; offers: true; businessInfo: true };
}>;

export function toClientRecord(row: ClientRow): ClientRecord {
  return {
    ...row,
    aiConfig: readAiConfig(row.aiConfig),
    dmReplyConfig: readDmConfig(row.dmReplyConfig),
    commentReplyConfig: readCommentConfig(row.commentReplyConfig),
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
