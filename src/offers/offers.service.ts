import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IOffersRepository,
  OFFERS_REPOSITORY,
} from './repositories/IOffersRepository.repository';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { Offer } from '@app/generated/prisma/client';
import { Prisma } from '@app/generated/prisma/client';
import { CreateOfferInput, UpdateOfferInput } from './schemas/offer.schema';
import { QueryOfferInput } from './schemas/query-offer.schema';
import { fieldError } from '@app/common/helpers/field-error';

@Injectable()
export class OffersService {
  constructor(
    @Inject(OFFERS_REPOSITORY) private readonly repo: IOffersRepository,
  ) {}
  create(input: CreateOfferInput): Promise<Offer> {
    return this.repo.create(input);
  }

  findAll(query: QueryOfferInput): Promise<PaginatedResult<Offer>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<Offer> {
    const result = await this.repo.findById(id);
    if (!result) throw new NotFoundException('Offer not found');
    return result;
  }

  async update(id: string, input: UpdateOfferInput): Promise<Offer> {
    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundException('Offer not found');
    // an offer never moves to another client; the same value is still accepted
    if (input.clientId !== undefined && input.clientId !== current.clientId) {
      throw fieldError('clientId', 'An offer cannot move to another client');
    }
    return this.repo.update(id, {
      ...input,
      ...(input.discountValue !== undefined && {
        discountValue: new Prisma.Decimal(input.discountValue),
      }),
    });
  }

  remove(id: string): Promise<void> {
    return this.repo.delete(id);
  }
}
