import { Module } from '@nestjs/common';
import { OffersService } from './offers.service';
import { OffersController } from './offers.controller';
import { OFFERS_REPOSITORY } from './repositories/IOffersRepository.repository';
import { OffersRepository } from './repositories/offers.repository.impl';

@Module({
  controllers: [OffersController],
  providers: [
    OffersService,
    { provide: OFFERS_REPOSITORY, useClass: OffersRepository },
  ],
  exports: [OffersService],
})
export class OffersModule {}
