import { Injectable } from '@nestjs/common';
import { Prisma, CommentReply } from '@app/generated/prisma/client';
import { PrismaService } from '@app/prisma/prisma.service';
import {
  PaginatedResult,
  paginate,
} from '@app/common/helpers/pagination.helper';
import {
  QueryCommentReplyInput,
  SaveCommentReplyInput,
} from '../schemas/comment-reply.schema';
import { ICommentsRepository } from './ICommentsRepository.repository';

@Injectable()
export class CommentsRepository implements ICommentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: QueryCommentReplyInput,
    clientId?: string,
  ): Promise<PaginatedResult<CommentReply>> {
    const where: Prisma.CommentReplyWhereInput = {
      ...(clientId && { clientId }),
      ...(query.platform && { platform: query.platform }),
      ...(query.classification && { classification: query.classification }),
      ...(query.commentId && { commentId: query.commentId }),
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from && { gte: query.from }),
              ...(query.to && { lte: query.to }),
            },
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.commentReply.findMany({
        where,
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
      },
    });
  }
}
