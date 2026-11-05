import { IBaseRepository } from '@common/repositories/base.repository.interface';
import { CreateClientData } from '../interfaces/create-client-data.interface';
import { UpdateClientData } from '../interfaces/update-client-data.interface';
import { ClientRecord, ClientWorkflowData } from '../types/client.types';
import { QueryClientInput } from '../schemas/query-client.schema';

export const CLIENTS_REPOSITORY = 'CLIENTS_REPOSITORY';

export interface IClientsRepository extends IBaseRepository<
  ClientRecord,
  CreateClientData,
  UpdateClientData,
  QueryClientInput
> {
  getClientDataForWorkFlow(brandId: string): Promise<ClientWorkflowData | null>;
  getAccessToken(clientId: string): Promise<string | null>;
  setAccessToken(clientId: string, encryptedToken: string): Promise<void>;
}
