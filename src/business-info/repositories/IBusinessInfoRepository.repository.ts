// clients/repositories/business-info.repository.interface.ts
import {
  BusinessInfoRecord,
  CreateBusinessInfoData,
  UpdateBusinessInfoData,
} from '../interfaces/business-info.interface';

export const BUSINESS_INFO_REPOSITORY = 'BUSINESS_INFO_REPOSITORY';

export interface IBusinessInfoRepository {
  findByClientId(clientId: string): Promise<BusinessInfoRecord | null>;
  create(data: CreateBusinessInfoData): Promise<BusinessInfoRecord>;
  update(
    clientId: string,
    data: UpdateBusinessInfoData,
  ): Promise<BusinessInfoRecord>;
  delete(clientId: string): Promise<void>;
}
