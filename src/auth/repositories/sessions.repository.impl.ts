import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  ISessionsRepository,
  SessionRecord,
} from './ISessionsRepository.repository';

const select = {
  id: true,
  userId: true,
  expiresAt: true,
  lastUsedAt: true,
  revokedAt: true,
} as const;

/** Sessions are stored in the `refresh_tokens` table (see data-model.md). */
@Injectable()
export class SessionsRepository implements ISessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.prisma.refreshToken.create({ data, select: { id: true } });
  }

  findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select,
    });
  }

  findById(id: string): Promise<SessionRecord | null> {
    return this.prisma.refreshToken.findUnique({ where: { id }, select });
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { lastUsedAt: at },
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: at },
    });
  }
}
