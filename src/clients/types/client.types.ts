// clients/types/client.types.ts
import { Client, Offer, Service } from '@app/generated/prisma/client';
import {
  AiConfig,
  CommentReplyConfig,
  DmReplyConfig,
  Variants,
} from '@common/zod/json-columns.schema';
import { BusinessInfoRecord } from '@app/business-info/interfaces/business-info.interface';

/** Client without the tokens, JSON columns parsed. Replaces SafeClient. */
export type ClientRecord = Omit<
  Client,
  | 'accessToken'
  | 'instaAccessToken'
  | 'aiConfig'
  | 'dmReplyConfig'
  | 'commentReplyConfig'
> & {
  aiConfig: AiConfig;
  dmReplyConfig: DmReplyConfig;
  commentReplyConfig: CommentReplyConfig;
};

/**
 * What the admin endpoints return: the record, plus whether each token is stored. The tokens
 * themselves never leave the repository; the dashboard only needs to know which ones are set.
 */
export type ClientAdminRecord = ClientRecord & {
  hasAccessToken: boolean;
  hasInstaAccessToken: boolean;
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

/** What the chat path needs to decide where a client's DMs go (research R1). */
export interface ChatRoute {
  clientId: string;
  name: string;
  chatSubscribed: boolean;
  chatWorkflowEndpoint: string | null;
}

/** The admin who made a change; copied into the activity log. */
export interface ClientActor {
  id: string;
  name: string;
  email: string;
}

export interface VersionConflictDetails {
  currentVersion: number;
  updatedAt: Date;
  updatedBy: { id: string; name: string } | null;
}

export type ClientUpdateResult =
  | { status: 'updated' | 'unchanged'; record: ClientAdminRecord }
  | ({ status: 'conflict' } & VersionConflictDetails);

export type AccountField = 'fbPageId' | 'instaAccountId';

/**
 * A decrypted token and the Graph API it belongs to: `facebook` is a Page token for
 * graph.facebook.com, `instagram` an Instagram Login token for graph.instagram.com.
 */
export interface GraphToken {
  token: string;
  api: 'facebook' | 'instagram';
}

/** The activity actions of a reply run on a post's unreplied comments. */
export type ReplyRunAction = 'REPLY_RUN_STARTED' | 'REPLY_RUN_STOPPED';

/** What an activity entry needs to name a client: it keeps the name, so it outlives the client. */
export interface ClientRef {
  id: string;
  name: string;
}
