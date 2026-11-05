import { IBaseRepository } from '@common/repositories/base.repository.interface';
import { Service } from '@app/generated/prisma/client';
import { CreateServiceData } from '../interfaces/create-service-data.interface';
import { UpdateServiceData } from '../interfaces/update-service-data.interface';
import { QueryServiceInput } from '../schemas/query-service.schema';

export const SERVICES_REPOSITORY = 'SERVICES_REPOSITORY';

export interface IServicesRepository extends IBaseRepository<
  Service,
  CreateServiceData,
  UpdateServiceData,
  QueryServiceInput
> {}
