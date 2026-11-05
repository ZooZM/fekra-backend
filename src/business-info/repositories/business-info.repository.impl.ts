// clients/repositories/business-info.repository.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@app/prisma/prisma.service';
import { BusinessInfo, Prisma } from '@app/generated/prisma/client';
import {
  readLocation,
  readSocialMedia,
  readWorkHours,
} from '@common/zod/json-readers';
import { IBusinessInfoRepository } from './IBusinessInfoRepository.repository';
import {
  BusinessInfoRecord,
  CreateBusinessInfoData,
  UpdateBusinessInfoData,
} from '../interfaces/business-info.interface';

// undefined = leave unchanged, null = clear the column
const jsonOrNull = <T>(v: T | null | undefined) =>
  v === undefined ? undefined : (v ?? Prisma.JsonNull);

@Injectable()
export class BusinessInfoRepository implements IBusinessInfoRepository {
  private readonly logger = new Logger(BusinessInfoRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByClientId(clientId: string): Promise<BusinessInfoRecord | null> {
    const row = await this.prisma.businessInfo.findUnique({
      where: { clientId },
    });
    return row ? this.toRecord(row) : null;
  }

  async create(data: CreateBusinessInfoData): Promise<BusinessInfoRecord> {
    const row = await this.prisma.businessInfo.create({
      data: {
        ...data,
        location: jsonOrNull(data.location),
        workHours: jsonOrNull(data.workHours),
      },
    });
    this.logger.debug(`create → business info for client ${data.clientId}`);
    return this.toRecord(row);
  }

  async update(
    clientId: string,
    data: UpdateBusinessInfoData,
  ): Promise<BusinessInfoRecord> {
    const row = await this.prisma.businessInfo.update({
      where: { clientId },
      data: {
        ...data,
        location: jsonOrNull(data.location),
        workHours: jsonOrNull(data.workHours),
      },
    });
    return this.toRecord(row);
  }

  async delete(clientId: string): Promise<void> {
    await this.prisma.businessInfo.delete({ where: { clientId } });
  }

  /** The single place where raw JSON columns become typed values. */
  private toRecord(row: BusinessInfo): BusinessInfoRecord {
    return {
      ...row,
      socialMedia: readSocialMedia(row.socialMedia),
      location: readLocation(row.location),
      workHours: readWorkHours(row.workHours),
    };
  }
}
