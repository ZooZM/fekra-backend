import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  IClientsRepository,
  CLIENTS_REPOSITORY,
} from './repositories/IClientsRepository.repository';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { TokenCryptoService } from '@app/crypto/token-crypto.service';
import { CreateClientInput, UpdateClientInput } from './schemas/client.schema';
import {
  ChatRoute,
  ClientActor,
  ClientRecord,
  ClientRef,
  ClientWorkflowData,
  ReplyRunAction,
} from './types/client.types';
import { ReplyRunActivityDetails } from '@common/zod/json-columns.schema';
import { randomUUID } from 'crypto';
import { Platform } from '@app/generated/prisma/client';
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
    await this.assertChatService(id, data);
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

  /**
   * True when the client exists and `accountId` is its account on that platform: the Facebook
   * page id or the Instagram account id. Read fresh (never cached), because the n8n lead endpoints
   * scope every read and write with it (feature 004).
   */
  async ownsAccount(
    clientId: string,
    platform: Platform,
    accountId: string,
  ): Promise<boolean> {
    const client = await this.repo.findById(clientId);
    if (!client) return false;
    const owned =
      platform === 'FACEBOOK' ? client.fbPageId : client.instaAccountId;
    return owned !== null && owned === accountId;
  }

  /** Null when there's no match, so webhook code can drop the event. Throw a 404 in a controller if an endpoint needs one. */
  getClientDataForWorkFlow(
    brandId: string,
  ): Promise<ClientWorkflowData | null> {
    return this.repo.getClientDataForWorkFlow(brandId);
  }

  /** The chat route by account id, read fresh (the cache is only an outage fallback). */
  findChatRoute(accountId: string): Promise<ChatRoute | null> {
    return this.repo.findChatRoute(accountId);
  }

  /** The chat route by client id, read fresh on every delivery attempt. */
  findChatRouteById(clientId: string): Promise<ChatRoute | null> {
    return this.repo.findChatRouteById(clientId);
  }

  /** Client, services, offers and business info for a DM batch, database first. */
  findWorkflowDataFresh(accountId: string): Promise<ClientWorkflowData | null> {
    return this.repo.findWorkflowDataFresh(accountId);
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

  /**
   * An edit may send only one of the two chat fields, so the rule "subscribed needs an endpoint"
   * is checked on the merged state. Several clients may use the same endpoint: a workflow can be
   * shared, and tells its clients apart by the client id in each request (feature 004). The version check in the repository protects this
   * read-merge-write: a concurrent edit changes the version and the save is refused.
   */
  private async assertChatService(
    id: string,
    data: { chatWorkflowEndpoint?: string | null; chatSubscribed?: boolean },
  ): Promise<void> {
    if (
      data.chatWorkflowEndpoint === undefined &&
      data.chatSubscribed === undefined
    ) {
      return;
    }
    const current = await this.repo.findById(id);
    if (!current) throw new NotFoundException('Client not found');

    const endpoint =
      data.chatWorkflowEndpoint !== undefined
        ? data.chatWorkflowEndpoint
        : current.chatWorkflowEndpoint;
    const subscribed = data.chatSubscribed ?? current.chatSubscribed;
    if (subscribed && !endpoint) {
      throw new UnprocessableEntityException({
        message: 'Validation failed',
        errorCode: 'INPUT_VALIDATION_ERROR',
        details: {
          formErrors: [],
          fieldErrors: {
            chatWorkflowEndpoint: [
              data.chatWorkflowEndpoint === null
                ? 'Unsubscribe the client before removing its endpoint'
                : 'Enter an endpoint before subscribing the client to the chat service',
            ],
          },
        },
      });
    }
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
