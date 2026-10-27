import { Test, TestingModule } from '@nestjs/testing';
import { OffersService } from './offers.service';
import { OFFERS_REPOSITORY } from './repositories/IOffersRepository.repository';

describe('OffersService', () => {
  let service: OffersService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OffersService, { provide: OFFERS_REPOSITORY, useValue: {} }],
    }).compile();

    service = module.get<OffersService>(OffersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
