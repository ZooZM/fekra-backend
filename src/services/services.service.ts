import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import {
  IServicesRepository,
  SERVICES_REPOSITORY,
} from './repositories/IServicesRepository.repository';
import { BaseQueryDto } from '@app/common/dto/query-base.dto';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { Service } from '@app/generated/prisma/client';
import { Prisma } from '@app/generated/prisma/client';

@Injectable()
export class ServicesService {
  constructor(
    @Inject(SERVICES_REPOSITORY) private readonly repo: IServicesRepository,
  ) {}
  create(dto: CreateServiceDto): Promise<Service> {
    return this.repo.create({
      ...dto,
      variants: dto.variants as Prisma.InputJsonValue | undefined,
    });
  }

  findAll(query?: BaseQueryDto): Promise<PaginatedResult<Service>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<Service> {
    const result = await this.repo.findById(id);
    if (!result) throw new NotFoundException('Service not found');
    return result;
  }

  update(id: string, dto: UpdateServiceDto): Promise<Service> {
    return this.repo.update(id, {
      ...dto,
      variants: dto.variants as Prisma.InputJsonValue | undefined,
    });
  }

  remove(id: string): Promise<void> {
    return this.repo.delete(id);
  }
}
