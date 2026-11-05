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

@Injectable()
export class ServicesService {
  constructor(
    @Inject(SERVICES_REPOSITORY) private readonly repo: IServicesRepository,
  ) {}
  create(input: CreateServiceInput): Promise<Service> {
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

  update(id: string, input: UpdateServiceInput): Promise<Service> {
    return this.repo.update(id, {
      ...input,
      variants: input.variants as Prisma.InputJsonValue | undefined,
    });
  }

  remove(id: string): Promise<void> {
    return this.repo.delete(id);
  }
}
