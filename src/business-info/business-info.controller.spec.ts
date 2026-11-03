import { Test, TestingModule } from '@nestjs/testing';
import { BusinessInfoController } from './business-info.controller';
import { BusinessInfoService } from './business-info.service';

describe('BusinessInfoController', () => {
  let controller: BusinessInfoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BusinessInfoController],
      providers: [{ provide: BusinessInfoService, useValue: {} }],
    }).compile();

    controller = module.get<BusinessInfoController>(BusinessInfoController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
