import { Injectable } from '@nestjs/common';
import { Prisma, Service } from '@app/generated/prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  paginate,
  PaginatedResult,
} from '@app/common/helpers/pagination.helper';
import { IServicesRepository } from './IServicesRepository.repository';
import { CreateServiceData } from '../interfaces/create-service-data.interface';
import { UpdateServiceData } from '../interfaces/update-service-data.interface';
import { QueryServiceInput } from '../schemas/query-service.schema';

const ORDER_FIELDS = ['name', 'price', 'createdAt'] as const;

@Injectable()
export class ServicesRepository implements IServicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryServiceInput): Promise<PaginatedResult<Service>> {
    const orderBy = ORDER_FIELDS.includes(query.orderBy)
      ? query.orderBy
      : 'createdAt';
    const where: Prisma.ServiceWhereInput = {
      ...(query.clientId && { clientId: query.clientId }),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.service.findMany({
        where,
        orderBy: [{ [orderBy]: query.orderDir }, { id: 'asc' }],
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
