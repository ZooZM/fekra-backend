import { Injectable } from '@nestjs/common';
import { Prisma, CommentReply } from '@app/generated/prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  PaginatedResult,
  paginate,
} from '@app/common/helpers/pagination.helper';
import { ExportFilters } from '@common/zod/json-columns.schema';
import {
  ExportCommentsQueryInput,
  QueryCommentReplyInput,
  SaveCommentReplyInput,
} from '../schemas/comment-reply.schema';
import { CommentRowWithClient, ExportActor } from '../types/comment.types';
import { ICommentsRepository } from './ICommentsRepository.repository';

const WITH_CLIENT = { client: { select: { name: true } } } as const;

type CommentFilters = Pick<
  QueryCommentReplyInput,
  'platform' | 'classification' | 'decisionBasis' | 'commentId' | 'from' | 'to'
>;

@Injectable()
export class CommentsRepository implements ICommentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The where clause shared by the list and the export, so their totals agree. */
  private where(
    filters: CommentFilters,
    clientId?: string,
    snapshotAt?: Date,
  ): Prisma.CommentReplyWhereInput {
    const upper =
      filters.to && snapshotAt
        ? new Date(Math.min(filters.to.getTime(), snapshotAt.getTime()))
        : (filters.to ?? snapshotAt);
    return {
      ...(clientId && { clientId }),
      ...(filters.platform && { platform: filters.platform }),
      ...(filters.classification && {
        classification: filters.classification,
      }),
      ...(filters.decisionBasis && { decisionBasis: filters.decisionBasis }),
      ...(filters.commentId && { commentId: filters.commentId }),
      ...(filters.from || upper
        ? {
            createdAt: {
              ...(filters.from && { gte: filters.from }),
              ...(upper && { lte: upper }),
            },
          }
        : {}),
    };
  }

  async findAll(
    query: QueryCommentReplyInput,
    clientId?: string,
  ): Promise<PaginatedResult<CommentRowWithClient>> {
    const where = this.where(query, clientId);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.commentReply.findMany({
        where,
        include: WITH_CLIENT,
        orderBy: [{ [query.orderBy]: query.orderDir }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.commentReply.count({ where }),
    ]);

    return paginate(data, total, query.page, query.limit);
  }

  save(data: SaveCommentReplyInput): Promise<CommentReply> {
    return this.prisma.commentReply.upsert({
      where: {
        platform_commentId: {
          platform: data.platform,
          commentId: data.commentId,
        },
      },
      create: data,
      update: {
        classification: data.classification,
        reason: data.reason,
        decisionBasis: data.decisionBasis,
        decisionModel: data.decisionModel ?? null,
      },
    });
  }

  async *iterateForExport(
    filters: ExportCommentsQueryInput,
    snapshotAt: Date,
    batch: number,
  ): AsyncGenerator<CommentRowWithClient> {
    const base = this.where(filters, filters.clientId, snapshotAt);
    let cursor: { createdAt: Date; id: string } | undefined;

    for (;;) {
      const rows = await this.prisma.commentReply.findMany({
        where: cursor
          ? {
              AND: [
                base,
                {
                  OR: [
                    { createdAt: { lt: cursor.createdAt } },
                    { createdAt: cursor.createdAt, id: { gt: cursor.id } },
                  ],
                },
              ],
            }
          : base,
        include: WITH_CLIENT,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: batch,
      });
      yield* rows;
      if (rows.length < batch) return;
      const last = rows[rows.length - 1];
      cursor = { createdAt: last.createdAt, id: last.id };
    }
  }

  async startExport(input: {
    actor: ExportActor;
    filters: ExportFilters;
  }): Promise<string> {
    const record = await this.prisma.commentExportRecord.create({
      data: {
        actorId: input.actor.id,
        actorName: input.actor.name,
        actorEmail: input.actor.email,
        filters: input.filters,
        completed: false,
      },
      select: { id: true },
    });
    return record.id;
  }

  async purgeBefore(cutoff: Date, batch = 5000): Promise<number> {
    let total = 0;
    for (;;) {
      const deleted = await this.prisma.$executeRaw`
        DELETE FROM comment_replies WHERE id IN (
          SELECT id FROM comment_replies WHERE created_at < ${cutoff} LIMIT ${batch})`;
      total += deleted;
      if (deleted < batch) return total;
    }
  }

  async finishExport(
    id: string,
    rowCount: number,
    completed: boolean,
  ): Promise<void> {
    await this.prisma.commentExportRecord.update({
      where: { id },
      data: { rowCount, completed },
    });
  }
}
