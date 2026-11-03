import { BusinessInfo } from '@app/generated/prisma/client';
import { CreateBusinessInfoDto } from '../dto/create-business-info.dto';
import { UpdateBusinessInfoDto } from '../dto/update-business-info.dto';

export const BUSINESS_INFO_REPOSITORY = 'BUSINESS_INFO_REPOSITORY';

export interface IBusinessInfoRepository {
  findAll(): Promise<BusinessInfo[]>;
  findByClientId(clientId: string): Promise<BusinessInfo | null>;
  create(data: CreateBusinessInfoDto): Promise<BusinessInfo>;
  update(clientId: string, data: UpdateBusinessInfoDto): Promise<BusinessInfo>;
  delete(clientId: string): Promise<void>;
}
