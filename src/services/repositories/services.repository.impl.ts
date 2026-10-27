import { Injectable } from '@nestjs/common';
import { Prisma, Service } from '@app/generated/prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import { BaseQueryDto } from '@app/common/dto/query-base.dto';
import {
  paginate,
  PaginatedResult,
} from '@app/common/helpers/pagination.helper';
import { IServicesRepository } from './IServicesRepository.repository';
import { CreateServiceData } from '../interfaces/create-service-data.interface';
import { UpdateServiceData } from '../interfaces/update-service-data.interface';

const ORDER_FIELDS = ['name', 'price', 'createdAt'] as const;
type OrderField = (typeof ORDER_FIELDS)[number];

@Injectable()
export class ServicesRepository implements IServicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query = new BaseQueryDto()): Promise<PaginatedResult<Service>> {
    const orderBy = ORDER_FIELDS.includes(query.orderBy as OrderField)
      ? (query.orderBy as OrderField)
      : 'createdAt';
    const where: Prisma.ServiceWhereInput = {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        orderBy: { [orderBy]: query.orderDir },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.service.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  findById(id: string): Promise<Service | null> {
    return this.prisma.service.findUnique({ where: { id } });
  }
  create(data: CreateServiceData): Promise<Service> {
    return this.prisma.service.create({ data });
  }
  update(id: string, data: UpdateServiceData): Promise<Service> {
    return this.prisma.service.update({ where: { id }, data });
  }
  async delete(id: string): Promise<void> {
    await this.prisma.service.delete({ where: { id } });
  }
}
