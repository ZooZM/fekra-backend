import { Module } from '@nestjs/common';
import { BusinessInfoService } from './business-info.service';
import { BusinessInfoController } from './business-info.controller';
import { BUSINESS_INFO_REPOSITORY } from './repositories/IBusinessInfoRepository.repository';
import { BusinessInfoRepository } from './repositories/business-info.repository.impl';

@Module({
  controllers: [BusinessInfoController],
  providers: [
    BusinessInfoService,
    { provide: BUSINESS_INFO_REPOSITORY, useClass: BusinessInfoRepository },
  ],
  exports: [BusinessInfoService],
})
export class BusinessInfoModule {}
