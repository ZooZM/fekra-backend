// clients/mappers/client.mapper.ts
import { BusinessInfo } from '@app/generated/prisma/client';
import {
  readSocialMedia,
  readLocation,
  readWorkHours,
} from '@common/zod/json-readers';
import { BusinessInfoRecord } from '../interfaces/business-info.interface';

export function toBusinessInfoRecord(row: BusinessInfo): BusinessInfoRecord {
  return {
    ...row,
    location: readLocation(row.location),
    socialMedia: readSocialMedia(row.socialMedia),
    workHours: readWorkHours(row.workHours),
  };
}
