// clients/types/client.types.ts
import { Client, Offer, Service } from '@app/generated/prisma/client';
import {
  AiConfig,
  CommentReplyConfig,
  DmReplyConfig,
  Variants,
} from '@common/zod/json-columns.schema';
import { BusinessInfoRecord } from '@app/business-info/interfaces/business-info.interface';

/** Client without the token, JSON columns parsed. Replaces SafeClient. */
export type ClientRecord = Omit<
  Client,
  'accessToken' | 'aiConfig' | 'dmReplyConfig' | 'commentReplyConfig'
> & {
  aiConfig: AiConfig;
  dmReplyConfig: DmReplyConfig;
  commentReplyConfig: CommentReplyConfig;
};

export type ServiceRecord = Omit<Service, 'variants'> & {
  variants: Variants | null;
};

/** What the n8n workflow receives. */
export type ClientWorkflowData = ClientRecord & {
  services: ServiceRecord[];
  offers: Offer[];
  businessInfo: BusinessInfoRecord | null;
};
