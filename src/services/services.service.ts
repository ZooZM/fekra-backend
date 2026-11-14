import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IServicesRepository,
  SERVICES_REPOSITORY,
} from './repositories/IServicesRepository.repository';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { Service } from '@app/generated/prisma/client';
import { Prisma } from '@app/generated/prisma/client';
import {
  CreateServiceInput,
  UpdateServiceInput,
} from './schemas/service.schema';
import { QueryServiceInput } from './schemas/query-service.schema';
import { OffersService } from '@app/offers/offers.service';
import { fieldError } from '@app/common/helpers/field-error';

@Injectable()
export class ServicesService {
  constructor(
    @Inject(SERVICES_REPOSITORY) private readonly repo: IServicesRepository,
    private readonly offers: OffersService,
  ) {}

  async create(input: CreateServiceInput): Promise<Service> {
    await this.assertOfferOfClient(input.offerId, input.clientId);
    return this.repo.create({
      ...input,
      variants: input.variants as Prisma.InputJsonValue | undefined,
    });
  }

  findAll(query: QueryServiceInput): Promise<PaginatedResult<Service>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<Service> {
    const result = await this.repo.findById(id);
    if (!result) throw new NotFoundException('Service not found');
    return result;
  }

  async update(id: string, input: UpdateServiceInput): Promise<Service> {
    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundException('Service not found');
    // a service never moves to another client; the same value is still accepted
    if (input.clientId !== undefined && input.clientId !== current.clientId) {
      throw fieldError('clientId', 'A service cannot move to another client');
    }
    await this.assertOfferOfClient(input.offerId, current.clientId);
    return this.repo.update(id, {
      ...input,
      variants: input.variants as Prisma.InputJsonValue | undefined,
    });
  }

  remove(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  /** A service can only have an offer of its own client (an unknown offer is the same error). */
  private async assertOfferOfClient(
    offerId: string | null | undefined,
    clientId: string,
  ): Promise<void> {
    if (!offerId) return;
    const offer = await this.offers.findById(offerId).catch((err: unknown) => {
      if (err instanceof NotFoundException) return null;
      throw err;
    });
    if (!offer) throw fieldError('offerId', 'Offer not found');
    if (offer.clientId !== clientId) {
      throw fieldError('offerId', 'Choose an offer of this client');
    }
  }
}
