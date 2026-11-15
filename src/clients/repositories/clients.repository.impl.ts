import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  Client,
  ClientActivityAction,
} from '@app/generated/prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  paginate,
  PaginatedResult,
} from '@app/common/helpers/pagination.helper';
import { escapeLike } from '@app/common/helpers/escape-like';
import { IClientsRepository } from './IClientsRepository.repository';
import { CreateClientData } from '../interfaces/create-client-data.interface';
import { UpdateClientData } from '../interfaces/update-client-data.interface';
import {
  AccountField,
  ChatRoute,
  ClientActor,
  ClientRecord,
  ClientRef,
  ClientUpdateResult,
  ClientWorkflowData,
  ReplyRunAction,
} from '../types/client.types';
import {
  ReplyRunActivityDetails,
  ReplyRunActivityDetailsSchema,
} from '@common/zod/json-columns.schema';
import {
  ClientWorkflowRow,
  toClientRecord,
  toWorkflowData,
} from '../mappers/client.mapper';
import { QueryClientInput } from '../schemas/query-client.schema';
import { changedFields } from '../helpers/changed-fields';
import { REDIS } from '@app/inbox/inbox.constants';
import { Redis } from 'ioredis';

@Injectable()
export class ClientsRepository implements IClientsRepository {
  private readonly logger = new Logger(ClientsRepository.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async findByAccountId(accountId: string): Promise<ClientRecord | null> {
    let row: Client | null;

    const cached = await this.redis.get(`client:account:${accountId}`);

    if (cached) {
      row = JSON.parse(cached) as Client;
    } else {
      row = await this.prisma.client.findFirst({
        where: { OR: [{ fbPageId: accountId }, { instaAccountId: accountId }] },
      });

      if (row) {
        await this.redis.set(
          `client:account:${accountId}`,
          JSON.stringify(row),
          'EX',
          30 * 60,
        );
      }
    }

    return row ? toClientRecord(row) : null;
  }

  async findAll(
    query: QueryClientInput,
  ): Promise<PaginatedResult<ClientRecord>> {
    // the same filter feeds the page and the total, so the count matches the search
    const search = query.search ? escapeLike(query.search) : undefined;
    const where: Prisma.ClientWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { businessCategory: { contains: search, mode: 'insensitive' } },
        ],
      }),
      ...(query.chatSubscribed !== undefined && {
        chatSubscribed: query.chatSubscribed,
      }),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: [{ [query.orderBy]: query.orderDir }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.count({ where }),
    ]);
    return paginate(rows.map(toClientRecord), total, query.page, query.limit);
  }

  async findById(id: string): Promise<ClientRecord | null> {
    const row = await this.prisma.client.findUnique({ where: { id } });
    return row ? toClientRecord(row) : null;
  }

  async create(
    data: CreateClientData,
    actor: ClientActor,
  ): Promise<ClientRecord> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.client.create({ data });
      await this.recordActivity(tx, {
        action: 'CREATED',
        clientId: row.id,
        clientName: row.name,
        actor,
      });
      return toClientRecord(row);
    });
  }

  async update(
    id: string,
    data: UpdateClientData,
    expectedVersion: number,
    actor: ClientActor,
  ): Promise<ClientUpdateResult | null> {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.client.findUnique({ where: { id } });
      if (!current) return null;
      if (current.version !== expectedVersion) {
        return this.conflict(tx, current);
      }

      const fields = changedFields(current, data);
      if (fields.length === 0) {
        return { status: 'unchanged', record: toClientRecord(current) };
      }

      // the version in the where clause makes this a compare-and-swap: a concurrent save
      // that slipped in after the read above leaves no row to update (P2025)
      let row: Client;
      try {
        row = await tx.client.update({
          where: { id, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2025'
        ) {
          const latest = await tx.client.findUnique({ where: { id } });
          return latest ? this.conflict(tx, latest) : null;
        }
        throw e;
      }
      await this.recordActivity(tx, {
        action: 'UPDATED',
        clientId: id,
        clientName: row.name,
        actor,
        changedFields: fields,
      });
      return { status: 'updated', record: toClientRecord(row) };
    });
  }

  async findMetaAccountConflict(
    ids: { fbPageId?: string | null; instaAccountId?: string | null },
    excludeId?: string,
  ): Promise<AccountField | null> {
    for (const field of ['fbPageId', 'instaAccountId'] as const) {
      const value = ids[field];
      if (!value) continue;
      const hit = await this.prisma.client.findFirst({
        where: { [field]: value, ...(excludeId && { id: { not: excludeId } }) },
        select: { id: true },
      });
      if (hit) return field;
    }
    return null;
  }

  async getClientDataForWorkFlow(
    brandId: string,
  ): Promise<ClientWorkflowData | null> {
    if (!brandId) return null;

    let row: ClientWorkflowRow | null;

    const cached = await this.redis.get(`client:workflow:${brandId}`);

    if (cached) {
      row = JSON.parse(cached) as ClientWorkflowRow;
    } else {
      row = await this.prisma.client.findFirst({
        where: { OR: [{ fbPageId: brandId }, { instaAccountId: brandId }] },
        include: { services: true, offers: true, businessInfo: true },
      });

      if (row) {
        await this.redis.set(
          `client:workflow:${brandId}`,
          JSON.stringify(row),
          'EX',
          30 * 60,
        ); // cache for 30 minutes
      }
    }

    this.logger.debug(
      `getClientDataForWorkFlow(${brandId}) → ${row ? row.id : 'not found'}`,
    );
    return row ? toWorkflowData(row) : null;
  }

  /**
   * Database first, so a saved subscription or endpoint applies to the very next message
   * (FR-046). The cache keeps the old resilience: it is only read when the database fails.
   */
  async findChatRoute(accountId: string): Promise<ChatRoute | null> {
    if (!accountId) return null;
    const key = `client:account:${accountId}`;
    let row: Client | null;
    try {
      row = await this.prisma.client.findFirst({
        where: { OR: [{ fbPageId: accountId }, { instaAccountId: accountId }] },
      });
      if (row) await this.cacheSet(key, row);
    } catch (err) {
      this.logger.warn(
        `Chat route read failed for account ${accountId}, trying the cache: ${(err as Error).message}`,
      );
      row = await this.cacheGet<Client>(key);
      if (!row) {
        this.logger.error(`No cached chat route for account ${accountId}`);
        return null;
      }
    }
    return row ? this.toChatRoute(row) : null;
  }

  async findChatRouteById(clientId: string): Promise<ChatRoute | null> {
    const row = await this.prisma.client.findUnique({
      where: { id: clientId },
    });
    return row ? this.toChatRoute(row) : null;
  }

  async findWorkflowDataFresh(
    accountId: string,
  ): Promise<ClientWorkflowData | null> {
    if (!accountId) return null;
    const key = `client:workflow:${accountId}`;
    let row: ClientWorkflowRow | null;
    try {
      row = await this.prisma.client.findFirst({
        where: { OR: [{ fbPageId: accountId }, { instaAccountId: accountId }] },
        include: { services: true, offers: true, businessInfo: true },
      });
      if (row) await this.cacheSet(key, row);
    } catch (err) {
      this.logger.warn(
        `Workflow data read failed for account ${accountId}, trying the cache: ${(err as Error).message}`,
      );
      row = await this.cacheGet<ClientWorkflowRow>(key);
      if (!row) {
        this.logger.error(`No cached workflow data for account ${accountId}`);
        return null;
      }
    }
    return row ? toWorkflowData(row) : null;
  }

  private toChatRoute(row: Client): ChatRoute {
    return {
      clientId: row.id,
      name: row.name,
      chatSubscribed: row.chatSubscribed,
      chatWorkflowEndpoint: row.chatWorkflowEndpoint,
    };
  }

  private async cacheSet(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', 30 * 60);
    } catch (err) {
      this.logger.warn(
        `Cache write failed for ${key}: ${(err as Error).message}`,
      );
    }
  }

  private async cacheGet<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  async getAccessToken(clientId: string): Promise<string | null> {
    const row = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { accessToken: true },
    });
    return row?.accessToken ?? null;
  }

  async setAccessToken(
    clientId: string,
    token: string,
    actor: ClientActor,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({
        where: { id: clientId },
        select: { name: true },
      });
      if (!client) return false;
      // the token is not part of the edit version, so replacing it never causes a conflict
      await tx.client.update({
        where: { id: clientId },
        data: { accessToken: token },
      });
      await this.recordActivity(tx, {
        action: 'ACCESS_TOKEN_REPLACED',
        clientId,
        clientName: client.name,
        actor,
      });
      return true;
    });
  }

  async delete(id: string, actor: ClientActor): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({
        where: { id },
        select: { name: true },
      });
      if (!client) return false;
      await tx.client.delete({ where: { id } });
      await this.recordActivity(tx, {
        action: 'DELETED',
        clientId: id,
        clientName: client.name,
        actor,
      });
      this.logger.debug(`delete(${id})`);
      return true;
    });
  }

  /** Who changed the client last, for the "someone else changed this" message. */
  private async conflict(
    tx: Prisma.TransactionClient,
    current: Client,
  ): Promise<ClientUpdateResult> {
    const last = await tx.clientActivity.findFirst({
      where: { clientId: current.id },
      orderBy: { createdAt: 'desc' },
      select: { actorId: true, actorName: true },
    });
    return {
      status: 'conflict',
      currentVersion: current.version,
      updatedAt: current.updatedAt,
      updatedBy: last ? { id: last.actorId, name: last.actorName } : null,
    };
  }

  async recordReplyRunActivity(
    client: ClientRef,
    action: ReplyRunAction,
    actor: ClientActor,
    details: ReplyRunActivityDetails,
  ): Promise<void> {
    await this.recordActivity(this.prisma, {
      action: action,
      clientId: client.id,
      clientName: client.name,
      actor,
      // the schema is this column's contract: fail here rather than store what can't be read back
      details: ReplyRunActivityDetailsSchema.parse(details),
    });
  }

  private async recordActivity(
    tx: Prisma.TransactionClient,
    entry: {
      action: ClientActivityAction;
      clientId: string;
      clientName: string;
      actor: ClientActor;
      changedFields?: string[];
      details?: ReplyRunActivityDetails;
    },
  ): Promise<void> {
    await tx.clientActivity.create({
      data: {
        action: entry.action,
        clientId: entry.clientId,
        clientName: entry.clientName,
        actorId: entry.actor.id,
        actorName: entry.actor.name,
        actorEmail: entry.actor.email,
        changedFields: entry.changedFields ?? [],
        details: entry.details,
      },
    });
  }
}
