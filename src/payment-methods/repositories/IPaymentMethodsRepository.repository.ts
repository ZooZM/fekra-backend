import { BusinessInfo } from '@app/generated/prisma/client';
import { CreatePaymentMethodDto } from '../dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from '../dto/update-payment-method.dto';

export const PAYMENT_METHODS_REPOSITORY = 'PAYMENT_METHODS_REPOSITORY';

export interface IPaymentMethodsRepository {
  findAll(): Promise<BusinessInfo[]>;
  findByClientId(clientId: string): Promise<BusinessInfo | null>;
  create(data: CreatePaymentMethodDto): Promise<BusinessInfo>;
  update(clientId: string, data: UpdatePaymentMethodDto): Promise<BusinessInfo>;
  delete(clientId: string): Promise<void>;
}
