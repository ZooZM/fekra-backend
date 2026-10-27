import { Inject, Injectable } from '@nestjs/common';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import {
  IPaymentMethodsRepository,
  PAYMENT_METHODS_REPOSITORY,
} from './repositories/IPaymentMethodsRepository.repository';
import { BusinessInfo } from '@app/generated/prisma/client';

@Injectable()
export class PaymentMethodsService {
  constructor(
    @Inject(PAYMENT_METHODS_REPOSITORY)
    private readonly repo: IPaymentMethodsRepository,
  ) {}
  create(dto: CreatePaymentMethodDto): Promise<BusinessInfo> {
    return this.repo.create(dto);
  }

  findAll() {
    return this.repo.findAll();
  }

  findByClientId(clientId: string): Promise<BusinessInfo | null> {
    return this.repo.findByClientId(clientId);
  }

  update(clientId: string, dto: UpdatePaymentMethodDto): Promise<BusinessInfo> {
    return this.repo.update(clientId, dto);
  }

  remove(clientId: string): Promise<void> {
    return this.repo.delete(clientId);
  }
}
