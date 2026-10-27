import { Module } from '@nestjs/common';
import { PaymentMethodsService } from './payment-methods.service';
import { PaymentMethodsController } from './payment-methods.controller';
import { PAYMENT_METHODS_REPOSITORY } from './repositories/IPaymentMethodsRepository.repository';
import { PaymentMethodsRepository } from './repositories/payment-methods.repository.impl';

@Module({
  controllers: [PaymentMethodsController],
  providers: [
    PaymentMethodsService,
    { provide: PAYMENT_METHODS_REPOSITORY, useClass: PaymentMethodsRepository },
  ],
  exports: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
