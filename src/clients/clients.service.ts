import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import {
  IClientsRepository,
  CLIENTS_REPOSITORY,
} from './repositories/IClientsRepository.repository';
import { BaseQueryDto } from '@app/common/dto/query-base.dto';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { Client } from '@app/generated/prisma/client';
import { Prisma } from '@app/generated/prisma/client';
import { TokenCryptoService } from '@app/crypto/token-crypto.service';

@Injectable()
export class ClientsService {
  constructor(
    private readonly cryptoService: TokenCryptoService,
    @Inject(CLIENTS_REPOSITORY) private readonly repo: IClientsRepository,
  ) {}

  create(dto: CreateClientDto): Promise<Client> {
    return this.repo.create({
      ...dto,
      aiConfig: dto.aiConfig as Prisma.InputJsonValue | undefined,
      dmReplyConfig: dto.dmReplyConfig as Prisma.InputJsonValue | undefined,
      commentReplyConfig: dto.commentReplyConfig as
        Prisma.InputJsonValue | undefined,
    });
  }

  findAll(query?: BaseQueryDto): Promise<PaginatedResult<Client>> {
    return this.repo.findAll(query);
  }

  async findById(id: string): Promise<Client> {
    const client = await this.repo.findById(id);
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  update(id: string, dto: UpdateClientDto): Promise<Client> {
    return this.repo.update(id, {
      ...dto,
      aiConfig: dto.aiConfig as Prisma.InputJsonValue | undefined,
      dmReplyConfig: dto.dmReplyConfig as Prisma.InputJsonValue | undefined,
      commentReplyConfig: dto.commentReplyConfig as
        Prisma.InputJsonValue | undefined,
    });
  }

  remove(id: string): Promise<void> {
    return this.repo.delete(id);
  }

  async getClientDataForWorkFlow(
    brandId: string,
  ): Promise<Omit<Client, 'accessToken'> | null> {
    const client = await this.repo.getClientDataForWorkFlow(brandId);
    if (!client) {
      throw new NotFoundException(
        `Client data not found for brandId: ${brandId}`,
      );
    }

    return client;
  }

  async setAccessToken(clientId: string, token: string): Promise<void> {
    await this.repo.setAccessToken(
      clientId,
      this.cryptoService.encrypt(token, clientId),
    );
  }

  async getAccessToken(clientId: string): Promise<string | null> {
    const token = await this.repo.getAccessToken(clientId);
    if (!token) {
      return null;
    }
    return this.cryptoService.decrypt(token, clientId);
  }
}
