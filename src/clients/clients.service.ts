import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  IClientsRepository,
  CLIENTS_REPOSITORY,
} from './repositories/IClientsRepository.repository';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { TokenCryptoService } from '@app/crypto/token-crypto.service';
import { CreateClientInput, UpdateClientInput } from './schemas/client.schema';
import { ClientRecord, ClientWorkflowData } from './types/client.types';
import { randomUUID } from 'crypto';
import { QueryClientInput } from './schemas/query-client.schema';

@Injectable()
export class ClientsService {
  constructor(
    private readonly crypto: TokenCryptoService,
    @Inject(CLIENTS_REPOSITORY) private readonly repo: IClientsRepository,
  ) {}

  create(input: CreateClientInput): Promise<ClientRecord> {
    const { accessToken, ...rest } = input;
    const id = randomUUID(); // generated first: it's the AAD for the encryption
    return this.repo.create({
      ...rest,
      id,
      accessToken: this.crypto.encrypt(accessToken, id),
    });
  }

  findAll(query: QueryClientInput): Promise<PaginatedResult<ClientRecord>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<ClientRecord> {
    const client = await this.repo.findById(id);
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  update(id: string, input: UpdateClientInput): Promise<ClientRecord> {
    const { accessToken, ...rest } = input;
    return this.repo.update(id, {
      ...rest,
      ...(accessToken && { accessToken: this.crypto.encrypt(accessToken, id) }),
    });
  }

  remove(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  /** Null when there's no match, so webhook code can drop the event. Throw a 404 in a controller if an endpoint needs one. */
  getClientDataForWorkFlow(
    brandId: string,
  ): Promise<ClientWorkflowData | null> {
    return this.repo.getClientDataForWorkFlow(brandId);
  }

  async setAccessToken(clientId: string, token: string): Promise<void> {
    await this.repo.setAccessToken(
      clientId,
      this.crypto.encrypt(token, clientId),
    );
  }

  async getAccessToken(clientId: string): Promise<string | null> {
    const stored = await this.repo.getAccessToken(clientId);
    return stored ? this.crypto.decrypt(stored, clientId) : null;
  }
}
