// clients/interfaces/business-info.interface.ts
import {
  Location,
  SocialMedia,
  WorkHours,
} from '@common/zod/json-columns.schema';
import {
  CreateBusinessInfoInput,
  UpdateBusinessInfoInput,
} from '../schemas/business-info.schema';

/** What gets stored on create: the validated request plus the owner, which the service takes from the route or the JWT. */
export type CreateBusinessInfoData = CreateBusinessInfoInput & {
  clientId: string;
};

/** What gets stored on update. The row is addressed by clientId, so there's nothing to add. */
export type UpdateBusinessInfoData = UpdateBusinessInfoInput;

/** What reads return: JSON columns already parsed and typed, so callers need no casts. */
export interface BusinessInfoRecord {
  id: string;
  clientId: string;
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  website: string | null;
  socialMedia: SocialMedia;
  location: Location | null;
  workHours: WorkHours | null;
  paymentMethods: string[];
  installmentOptions: string[];
  createdAt: Date;
  updatedAt: Date;
}
