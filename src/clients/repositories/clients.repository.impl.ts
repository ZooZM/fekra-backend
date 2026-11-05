import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Client } from '@app/generated/prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import { BaseQueryDto } from '@app/common/dto/query-base.dto';
import {
  paginate,
  PaginatedResult,
} from '@app/common/helpers/pagination.helper';
import { IClientsRepository } from './IClientsRepository.repository';
import { CreateClientData } from '../interfaces/create-client-data.interface';
import { UpdateClientData } from '../interfaces/update-client-data.interface';
import { ClientRecord, ClientWorkflowData } from '../types/client.types';
import { toClientRecord, toWorkflowData } from '../mappers/client.mapper';
import { QueryClientInput } from '../schemas/query-client.schema';

@Injectable()
export class ClientsRepository implements IClientsRepository {
  private readonly logger = new Logger(ClientsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryClientInput,
  ): Promise<PaginatedResult<ClientRecord>> {
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        orderBy: [{ [query.orderBy]: query.orderDir }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.count(),
    ]);
    return paginate(rows.map(toClientRecord), total, query.page, query.limit);
  }

  async findById(id: string): Promise<ClientRecord | null> {
    const row = await this.prisma.client.findUnique({ where: { id } });
    return row ? toClientRecord(row) : null;
  }

  async create(data: CreateClientData): Promise<ClientRecord> {
    return toClientRecord(await this.prisma.client.create({ data }));
  }

  async update(id: string, data: UpdateClientData): Promise<ClientRecord> {
    return toClientRecord(
      await this.prisma.client.update({ where: { id }, data }),
    );
  }

  async getClientDataForWorkFlow(
    brandId: string,
  ): Promise<ClientWorkflowData | null> {
    if (!brandId) return null;

    // the query is inline so Prisma infers the include type, which a separate
    // `Prisma.ClientFindFirstArgs` variable would erase
    const row = await this.prisma.client.findFirst({
      where: { OR: [{ fbPageId: brandId }, { instaAccountId: brandId }] },
      include: { services: true, offers: true, businessInfo: true },
    });

    this.logger.debug(
      `getClientDataForWorkFlow(${brandId}) → ${row ? row.id : 'not found'}`,
    );
    return row ? toWorkflowData(row) : null;
  }

  async getAccessToken(clientId: string): Promise<string | null> {
    const row = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { accessToken: true },
    });
    return row?.accessToken ?? null;
  }

  async setAccessToken(clientId: string, token: string): Promise<void> {
    await this.prisma.client.update({
      where: { id: clientId },
      data: { accessToken: token },
    });
  }

  async delete(id: string): Promise<void> {
    const res = await this.prisma.client.delete({
      where: { id },
    });

    this.logger.debug(`delete(${id}), deletedClient(${res})`);
  }
}
