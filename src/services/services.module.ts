import { Module } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { SERVICES_REPOSITORY } from './repositories/IServicesRepository.repository';
import { ServicesRepository } from './repositories/services.repository.impl';
import { OffersModule } from '@app/offers/offers.module';

@Module({
  imports: [OffersModule], // the offer of a service must belong to the same client
  controllers: [ServicesController],
  providers: [
    ServicesService,
    { provide: SERVICES_REPOSITORY, useClass: ServicesRepository },
  ],
  exports: [ServicesService],
})
export class ServicesModule {}
