import { Inject, Injectable } from '@nestjs/common';
import { CreateBusinessInfoDto } from './dto/create-business-info.dto';
import { UpdateBusinessInfoDto } from './dto/update-business-info.dto';
import {
  IBusinessInfoRepository,
  BUSINESS_INFO_REPOSITORY,
} from './repositories/IBusinessInfoRepository.repository';
import { BusinessInfo } from '@app/generated/prisma/client';

@Injectable()
export class BusinessInfoService {
  constructor(
    @Inject(BUSINESS_INFO_REPOSITORY)
    private readonly repo: IBusinessInfoRepository,
  ) {}
  create(dto: CreateBusinessInfoDto): Promise<BusinessInfo> {
    return this.repo.create(dto);
  }

  findAll() {
    return this.repo.findAll();
  }

  findByClientId(clientId: string): Promise<BusinessInfo | null> {
    return this.repo.findByClientId(clientId);
  }

  update(clientId: string, dto: UpdateBusinessInfoDto): Promise<BusinessInfo> {
    return this.repo.update(clientId, dto);
  }

  remove(clientId: string): Promise<void> {
    return this.repo.delete(clientId);
  }
}
