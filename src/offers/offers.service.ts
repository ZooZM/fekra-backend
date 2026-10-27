import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateOfferDto } from './dto/create-offer.dto';
import { UpdateOfferDto } from './dto/update-offer.dto';
import {
  IOffersRepository,
  OFFERS_REPOSITORY,
} from './repositories/IOffersRepository.repository';
import { BaseQueryDto } from '@app/common/dto/query-base.dto';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { Offer } from '@app/generated/prisma/client';
import { Prisma } from '@app/generated/prisma/client';

@Injectable()
export class OffersService {
  constructor(
    @Inject(OFFERS_REPOSITORY) private readonly repo: IOffersRepository,
  ) {}
  create(dto: CreateOfferDto): Promise<Offer> {
    return this.repo.create({
      ...dto,
      discountValue: new Prisma.Decimal(dto.discountValue),
    });
  }

  findAll(query?: BaseQueryDto): Promise<PaginatedResult<Offer>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<Offer> {
    const result = await this.repo.findById(id);
    if (!result) throw new NotFoundException('Offer not found');
    return result;
  }

  update(id: string, dto: UpdateOfferDto): Promise<Offer> {
    return this.repo.update(id, {
      ...dto,
      ...(dto.discountValue !== undefined && {
        discountValue: new Prisma.Decimal(dto.discountValue),
      }),
    });
  }

  remove(id: string): Promise<void> {
    return this.repo.delete(id);
  }
}
