import { Test, TestingModule } from '@nestjs/testing';
import { BusinessInfoService } from './business-info.service';
import { BUSINESS_INFO_REPOSITORY } from './repositories/IBusinessInfoRepository.repository';

describe('BusinessInfoService', () => {
  let service: BusinessInfoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BusinessInfoService,
        { provide: BUSINESS_INFO_REPOSITORY, useValue: {} },
      ],
    }).compile();

    service = module.get<BusinessInfoService>(BusinessInfoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
