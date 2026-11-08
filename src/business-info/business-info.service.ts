import { Inject, Injectable } from '@nestjs/common';
import {
  IBusinessInfoRepository,
  BUSINESS_INFO_REPOSITORY,
} from './repositories/IBusinessInfoRepository.repository';
import {
  CreateBusinessInfoInput,
  UpdateBusinessInfoInput,
} from './schemas/business-info.schema';
import { BusinessInfoRecord } from './interfaces/business-info.interface';

@Injectable()
export class BusinessInfoService {
  constructor(
    @Inject(BUSINESS_INFO_REPOSITORY)
    private readonly repo: IBusinessInfoRepository,
  ) {}
  create(input: CreateBusinessInfoInput): Promise<BusinessInfoRecord> {
    return this.repo.create(input);
  }

  findByClientId(clientId: string): Promise<BusinessInfoRecord | null> {
    return this.repo.findByClientId(clientId);
  }

  update(
    clientId: string,
    input: UpdateBusinessInfoInput,
  ): Promise<BusinessInfoRecord> {
    return this.repo.update(clientId, input);
  }

  remove(clientId: string): Promise<void> {
    return this.repo.delete(clientId);
  }
}
