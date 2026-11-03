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

const ORDER_FIELDS = ['name', 'businessCategory', 'createdAt'] as const;
type OrderField = (typeof ORDER_FIELDS)[number];

@Injectable()
export class ClientsRepository implements IClientsRepository {
  private readonly logger = new Logger(ClientsRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll(query = new BaseQueryDto()): Promise<PaginatedResult<Client>> {
    const orderBy = ORDER_FIELDS.includes(query.orderBy as OrderField)
      ? (query.orderBy as OrderField)
      : 'createdAt';
    const where: Prisma.ClientWhereInput = {};
    const [data, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { [orderBy]: query.orderDir },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.client.count({ where }),
    ]);
    return paginate(data, total, query.page, query.limit);
  }

  findById(id: string): Promise<Client | null> {
    return this.prisma.client.findUnique({ where: { id } });
  }

  create(data: CreateClientData): Promise<Client> {
    return this.prisma.client.create({ data });
  }

  update(id: string, data: UpdateClientData): Promise<Client> {
    return this.prisma.client.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.client.delete({ where: { id } });
    this.logger.debug(`delete(${id})`);
  }

  async getClientDataForWorkFlow(
    brandId: string,
  ): Promise<Omit<Client, 'accessToken'> | null> {
    if (!brandId) {
      this.logger.warn('getClientDataForWorkFlow called with empty brandId');
      return null;
    }

    const query: Prisma.ClientFindFirstArgs = {
      where: { OR: [{ fbPageId: brandId }, { instaAccountId: brandId }] },
      omit: { accessToken: true },
      include: {
        services: true,
        offers: true,
        businessInfo: true,
      },
    };

    const client = await this.prisma.client.findFirst(query);

    this.logger.debug(
      `getClientDataForWorkFlow(${brandId}) => ${JSON.stringify(client)}`,
    );
    return client;
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
}
