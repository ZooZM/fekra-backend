import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '@app/users/types/safe-user.type';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import {
  QueryCommentReplyInput,
  SaveCommentReplySchema,
} from './schemas/comment-reply.schema';
import { CommentReply } from '@app/generated/prisma/client';
import {
  COMMENTS_REPOSITORY,
  ICommentsRepository,
} from './repositories/ICommentsRepository.repository';

@Injectable()
export class CommentsService {
  constructor(
    @Inject(COMMENTS_REPOSITORY) private readonly repo: ICommentsRepository,
  ) {}

  findAll(
    query: QueryCommentReplyInput,
    user: SafeUser,
  ): Promise<PaginatedResult<CommentReply>> {
    return this.repo.findAll(query, this.scopeClientId(query.clientId, user));
  }

  save(input: z.input<typeof SaveCommentReplySchema>): Promise<CommentReply> {
    return this.repo.save(SaveCommentReplySchema.parse(input));
  }

  private scopeClientId(
    requestedClientId: string | undefined,
    user: SafeUser,
  ): string | undefined {
    if (user.roles.includes(UserRole.ADMIN)) return requestedClientId;
    if (user.roles.includes(UserRole.CLIENT) && user.clientId) {
      return user.clientId;
    }
    throw new ForbiddenException('User is not assigned to a client');
  }
}
