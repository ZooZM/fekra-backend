import { Injectable } from '@nestjs/common';
import { Offer, Prisma } from '@app/generated/prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  paginate,
  PaginatedResult,
} from '@app/common/helpers/pagination.helper';
import { IOffersRepository } from './IOffersRepository.repository';
import { CreateOfferData } from '../interfaces/create-offer-data.interface';
import { UpdateOfferData } from '../interfaces/update-offer-data.interface';
import { QueryOfferInput } from '../schemas/query-offer.schema';

const ORDER_FIELDS = ['title', 'startDate', 'endDate', 'createdAt'] as const;

@Injectable()
export class OffersRepository implements IOffersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: QueryOfferInput): Promise<PaginatedResult<Offer>> {
    const orderBy = ORDER_FIELDS.includes(query.orderBy)
      ? query.orderBy
      : 'createdAt';
    const where: Prisma.OfferWhereInput = {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.offer.findMany({
        where,
        orderBy: { [orderBy]: query.orderDir },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.offer.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  findById(id: string): Promise<Offer | null> {
    return this.prisma.offer.findUnique({ where: { id } });
  }
  create(data: CreateOfferData): Promise<Offer> {
    return this.prisma.offer.create({ data });
  }
  update(id: string, data: UpdateOfferData): Promise<Offer> {
    return this.prisma.offer.update({ where: { id }, data });
  }
  async delete(id: string): Promise<void> {
    await this.prisma.offer.delete({ where: { id } });
  }
}
