import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/prisma/prisma.service';
import { BusinessInfo } from '@app/generated/prisma/client';
import { IPaymentMethodsRepository } from './IPaymentMethodsRepository.repository';
import { CreatePaymentMethodDto } from '../dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from '../dto/update-payment-method.dto';

@Injectable()
export class PaymentMethodsRepository implements IPaymentMethodsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<BusinessInfo[]> {
    return this.prisma.businessInfo.findMany();
  }

  findByClientId(clientId: string): Promise<BusinessInfo | null> {
    return this.prisma.businessInfo.findUnique({ where: { clientId } });
  }

  create(data: CreatePaymentMethodDto): Promise<BusinessInfo> {
    return this.prisma.businessInfo.upsert({
      where: { clientId: data.clientId },
      create: {
        clientId: data.clientId,
        paymentMethods: data.paymentMethods,
        installmentOptions: data.installmentOptions,
      },
      update: {
        paymentMethods: data.paymentMethods,
        installmentOptions: data.installmentOptions,
      },
    });
  }

  update(
    clientId: string,
    data: UpdatePaymentMethodDto,
  ): Promise<BusinessInfo> {
    return this.prisma.businessInfo.update({
      where: { clientId },
      data: {
        ...(data.paymentMethods !== undefined && {
          paymentMethods: data.paymentMethods,
        }),
        ...(data.installmentOptions !== undefined && {
          installmentOptions: data.installmentOptions,
        }),
      },
    });
  }

  async delete(clientId: string): Promise<void> {
    await this.prisma.businessInfo.update({
      where: { clientId },
      data: { paymentMethods: [], installmentOptions: [] },
    });
  }
}
