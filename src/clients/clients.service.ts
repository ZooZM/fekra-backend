import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  IClientsRepository,
  CLIENTS_REPOSITORY,
} from './repositories/IClientsRepository.repository';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { TokenCryptoService } from '@app/crypto/token-crypto.service';
import { CreateClientInput, UpdateClientInput } from './schemas/client.schema';
import {
  ClientActor,
  ClientRecord,
  ClientRef,
  ClientWorkflowData,
  ReplyRunAction,
} from './types/client.types';
import { ReplyRunActivityDetails } from '@common/zod/json-columns.schema';
import { randomUUID } from 'crypto';
import { QueryClientInput } from './schemas/query-client.schema';

@Injectable()
export class ClientsService {
  constructor(
    private readonly crypto: TokenCryptoService,
    @Inject(CLIENTS_REPOSITORY) private readonly repo: IClientsRepository,
  ) {}

  async create(
    input: CreateClientInput,
    actor: ClientActor,
  ): Promise<ClientRecord> {
    await this.assertAccountsFree(input);
    const { accessToken, ...rest } = input;
    const id = randomUUID(); // generated first: it's the AAD for the encryption
    return this.repo.create(
      { ...rest, id, accessToken: this.crypto.encrypt(accessToken, id) },
      actor,
    );
  }

  findAll(query: QueryClientInput): Promise<PaginatedResult<ClientRecord>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<ClientRecord> {
    const client = await this.repo.findById(id);
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  findByAccountId(accountId: string): Promise<ClientRecord | null> {
    return this.repo.findByAccountId(accountId);
  }

  async update(
    id: string,
    input: UpdateClientInput,
    actor: ClientActor,
  ): Promise<ClientRecord> {
    const { version, ...data } = input;
    await this.assertAccountsFree(data, id);
    const result = await this.repo.update(id, data, version, actor);
    if (!result) throw new NotFoundException('Client not found');
    if (result.status === 'conflict') {
      const { currentVersion, updatedAt, updatedBy } = result;
      throw new ConflictException({
        message: 'Client was changed by someone else',
        errorCode: 'CLIENT_VERSION_CONFLICT',
        details: { currentVersion, updatedAt, updatedBy },
      });
    }
    return result.record;
  }

  async remove(id: string, actor: ClientActor): Promise<void> {
    if (!(await this.repo.delete(id, actor))) {
      throw new NotFoundException('Client not found');
    }
  }

  /** Null when there's no match, so webhook code can drop the event. Throw a 404 in a controller if an endpoint needs one. */
  getClientDataForWorkFlow(
    brandId: string,
  ): Promise<ClientWorkflowData | null> {
    return this.repo.getClientDataForWorkFlow(brandId);
  }

  async setAccessToken(
    clientId: string,
    token: string,
    actor: ClientActor,
  ): Promise<void> {
    const stored = await this.repo.setAccessToken(
      clientId,
      this.crypto.encrypt(token, clientId),
      actor,
    );
    if (!stored) throw new NotFoundException('Client not found');
  }

  /**
   * Puts a reply run's start or stop in the activity record (FR-019). It takes the client's
   * name from the run instead of reading the client, so a run stopped after its client was
   * deleted is still recorded.
   */
  recordReplyRun(
    client: ClientRef,
    action: ReplyRunAction,
    actor: ClientActor,
    details: ReplyRunActivityDetails,
  ): Promise<void> {
    return this.repo.recordReplyRunActivity(client, action, actor, details);
  }

  async getAccessToken(clientId: string): Promise<string | null> {
    const stored = await this.repo.getAccessToken(clientId);
    return stored ? this.crypto.decrypt(stored, clientId) : null;
  }

  /** A Facebook page / Instagram account can belong to one client only (webhooks match on it). */
  private async assertAccountsFree(
    ids: { fbPageId?: string | null; instaAccountId?: string | null },
    excludeId?: string,
  ): Promise<void> {
    const field = await this.repo.findMetaAccountConflict(
      { fbPageId: ids.fbPageId, instaAccountId: ids.instaAccountId },
      excludeId,
    );
    if (field) {
      throw new ConflictException({
        message: 'Account already connected to another client',
        errorCode: 'DUPLICATE_KEY_ERROR',
        details: { field },
      });
    }
  }
}
