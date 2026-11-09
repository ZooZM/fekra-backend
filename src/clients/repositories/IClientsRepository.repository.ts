import { IBaseRepository } from '@common/repositories/base.repository.interface';
import { CreateClientData } from '../interfaces/create-client-data.interface';
import { UpdateClientData } from '../interfaces/update-client-data.interface';
import {
  AccountField,
  ClientActor,
  ClientRecord,
  ClientRef,
  ClientUpdateResult,
  ClientWorkflowData,
  ReplyRunAction,
} from '../types/client.types';
import { ReplyRunActivityDetails } from '@common/zod/json-columns.schema';
import { QueryClientInput } from '../schemas/query-client.schema';

export const CLIENTS_REPOSITORY = 'CLIENTS_REPOSITORY';

// create/update/delete take the acting admin and write the activity entry in the same
// transaction, so a change and its record can't separate.
export interface IClientsRepository extends Omit<
  IBaseRepository<
    ClientRecord,
    CreateClientData,
    UpdateClientData,
    QueryClientInput
  >,
  'create' | 'update' | 'delete'
> {
  create(data: CreateClientData, actor: ClientActor): Promise<ClientRecord>;
  /** null: no such client. */
  update(
    id: string,
    data: UpdateClientData,
    expectedVersion: number,
    actor: ClientActor,
  ): Promise<ClientUpdateResult | null>;
  /** false: no such client. */
  delete(id: string, actor: ClientActor): Promise<boolean>;

  /** The first account id already used by another client, if any. */
  findMetaAccountConflict(
    ids: { fbPageId?: string | null; instaAccountId?: string | null },
    excludeId?: string,
  ): Promise<AccountField | null>;
  getClientDataForWorkFlow(brandId: string): Promise<ClientWorkflowData | null>;
  getAccessToken(clientId: string): Promise<string | null>;
  /**
   * Records a reply run starting or stopping. No client row changes, so this is one insert and
   * the client does not have to exist anymore: the entry keeps its name.
   */
  recordReplyRunActivity(
    client: ClientRef,
    action: ReplyRunAction,
    actor: ClientActor,
    details: ReplyRunActivityDetails,
  ): Promise<void>;
  /** false: no such client. Does not change the version. */
  setAccessToken(
    clientId: string,
    encryptedToken: string,
    actor: ClientActor,
  ): Promise<boolean>;
}
