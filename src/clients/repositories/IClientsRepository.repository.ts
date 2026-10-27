import { IBaseRepository } from '@common/repositories/base.repository.interface';
import { Client } from '@app/generated/prisma/client';
import { CreateClientData } from '../interfaces/create-client-data.interface';
import { UpdateClientData } from '../interfaces/update-client-data.interface';

export const CLIENTS_REPOSITORY = 'CLIENTS_REPOSITORY';

export interface IClientsRepository extends IBaseRepository<
  Client,
  CreateClientData,
  UpdateClientData
> {}
