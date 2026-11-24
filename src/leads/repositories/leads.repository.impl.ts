import { Injectable } from '@nestjs/common';
import { PrismaService } from '@app/prisma/prisma.service';
import { ILeadsRepository } from './ILeadsRepository.repository';
import { LeadKey, LeadWrite } from '../interfaces/lead-write.interface';
import {
  LeadRecord,
  StaleLeadCandidate,
  StaleLeadCursor,
  UpsertLeadResult,
} from '../types/lead.types';
import { toLeadRecord } from '../mappers/lead.mapper';

@Injectable()
export class LeadsRepository implements ILeadsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByKey(key: LeadKey, clientId: string): Promise<LeadRecord | null> {
    const row = await this.prisma.lead.findFirst({
      where: { ...key, clientId },
    });
    return row ? toLeadRecord(row) : null;
  }

  findStale(
    cutoff: Date,
    cursor: StaleLeadCursor | undefined,
    take: number,
  ): Promise<StaleLeadCandidate[]> {
    return this.prisma.lead.findMany({
      where: {
        AND: [
          { updatedAt: { lt: cutoff } },
          {
            OR: [
              { phone: null },
              { country: null },
              { lastIntent: null },
              { summary: null },
              { notifiedAt: null },
            ],
          },
          ...(cursor
            ? [
                {
                  OR: [
                    { updatedAt: { gt: cursor.updatedAt } },
                    { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
                  ],
                },
              ]
            : []),
        ],
      },
      select: {
        id: true,
        clientId: true,
        platform: true,
        accountId: true,
        senderId: true,
        stage: true,
        phone: true,
        country: true,
        lastIntent: true,
        summary: true,
        notifiedAt: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take,
    });
  }

  upsert(
    key: LeadKey,
    clientId: string,
    build: (current: LeadRecord | null) => LeadWrite,
    claimNotification: boolean,
  ): Promise<UpsertLeadResult> {
    return this.prisma.$transaction(async (tx) => {
      // Make sure the row exists: INSERT … ON CONFLICT DO NOTHING, so a concurrent save that
      // inserted it first is not an error.
      const inserted = await tx.lead.createMany({
        data: [{ ...key, clientId }],
        skipDuplicates: true,
      });
      // Lock it: concurrent saves for the same customer now merge one after the other.
      await tx.$queryRaw`
        SELECT id FROM leads
        WHERE platform = ${key.platform}::"Platform"
          AND account_id = ${key.accountId}
          AND sender_id = ${key.senderId}
        FOR UPDATE`;
      const row = await tx.lead.findUniqueOrThrow({
        where: { platform_accountId_senderId: key },
      });
      // A row this transaction just inserted holds only defaults: it is a new lead.
      const current = inserted.count === 1 ? null : toLeadRecord(row);
      let saved = await tx.lead.update({
        where: { id: row.id },
        data: build(current),
      });

      let notifiedNow = false;
      if (claimNotification) {
        // Conditional update: only the save that still finds notifiedAt empty sets it. It holds
        // even without the lock above, so two requests can never both win.
        const claimed = await tx.lead.updateMany({
          where: { id: row.id, notifiedAt: null },
          data: { notifiedAt: new Date() },
        });
        notifiedNow = claimed.count === 1;
        if (notifiedNow) {
          saved = await tx.lead.findUniqueOrThrow({ where: { id: row.id } });
        }
      }
      return { lead: toLeadRecord(saved), notifiedNow };
    });
  }

  async purgeBefore(cutoff: Date, batch = 5000): Promise<number> {
    // At most `batch` rows per statement, so a backlog never holds a long lock on the table the
    // n8n saves write to.
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM leads WHERE id IN (
          SELECT id FROM leads WHERE updated_at < ${cutoff} LIMIT ${batch})`;
      total += deleted;
      if (deleted < batch) break;
    }
    return total;
  }
}
