import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import {
  QueryCommentReplyInput,
  SaveCommentReplyInput,
} from '../schemas/comment-reply.schema';
import { CommentReply } from '@app/generated/prisma/client';

export const COMMENTS_REPOSITORY = 'COMMENTS_REPOSITORY';

export interface ICommentsRepository {
  findAll(
    query: QueryCommentReplyInput,
    clientId?: string,
  ): Promise<PaginatedResult<CommentReply>>;
  save(data: SaveCommentReplyInput): Promise<CommentReply>;
}
