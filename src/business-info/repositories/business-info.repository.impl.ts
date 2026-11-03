import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/prisma/prisma.service';
import { BusinessInfo, Prisma } from '@app/generated/prisma/client';
import { IBusinessInfoRepository } from './IBusinessInfoRepository.repository';
import { CreateBusinessInfoDto } from '../dto/create-business-info.dto';
import { UpdateBusinessInfoDto } from '../dto/update-business-info.dto';

@Injectable()
export class BusinessInfoRepository implements IBusinessInfoRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(): Promise<BusinessInfo[]> {
    return this.prisma.businessInfo.findMany();
  }

  findByClientId(clientId: string): Promise<BusinessInfo | null> {
    return this.prisma.businessInfo.findUnique({ where: { clientId } });
  }

  create(data: CreateBusinessInfoDto): Promise<BusinessInfo> {
    return this.prisma.businessInfo.upsert({
      where: { clientId: data.clientId },
      create: {
        clientId: data.clientId,
        phone: data.phone,
        email: data.email,
        whatsapp: data.whatsapp,
        website: data.website,
        socialMedia: data.socialMedia as Prisma.InputJsonValue | undefined,
        location: data.location as Prisma.InputJsonValue | undefined,
        workHours: data.workHours as Prisma.InputJsonValue | undefined,
        paymentMethods: data.paymentMethods,
        installmentOptions: data.installmentOptions,
      },
      update: {
        phone: data.phone,
        email: data.email,
        whatsapp: data.whatsapp,
        website: data.website,
        socialMedia: data.socialMedia as Prisma.InputJsonValue | undefined,
        location: data.location as Prisma.InputJsonValue | undefined,
        workHours: data.workHours as Prisma.InputJsonValue | undefined,
        paymentMethods: data.paymentMethods,
        installmentOptions: data.installmentOptions,
      },
    });
  }

  update(
    clientId: string,
    data: UpdateBusinessInfoDto,
  ): Promise<BusinessInfo> {
    return this.prisma.businessInfo.update({
      where: { clientId },
      data: {
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.email !== undefined && { email: data.email }),
        ...(data.whatsapp !== undefined && { whatsapp: data.whatsapp }),
        ...(data.website !== undefined && { website: data.website }),
        ...(data.socialMedia !== undefined && {
          socialMedia: data.socialMedia as Prisma.InputJsonValue,
        }),
        ...(data.location !== undefined && {
          location: data.location as Prisma.InputJsonValue,
        }),
        ...(data.workHours !== undefined && {
          workHours: data.workHours as Prisma.InputJsonValue,
        }),
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
    await this.prisma.businessInfo.delete({ where: { clientId } });
  }
}
