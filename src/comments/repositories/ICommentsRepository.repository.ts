import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { ExportFilters } from '@common/zod/json-columns.schema';
import {
  ExportCommentsQueryInput,
  QueryCommentReplyInput,
  SaveCommentReplyInput,
} from '../schemas/comment-reply.schema';
import { CommentReply } from '@app/generated/prisma/client';
import { CommentRowWithClient, ExportActor } from '../types/comment.types';

export const COMMENTS_REPOSITORY = 'COMMENTS_REPOSITORY';

export interface ICommentsRepository {
  findAll(
    query: QueryCommentReplyInput,
    clientId?: string,
  ): Promise<PaginatedResult<CommentRowWithClient>>;
  save(data: SaveCommentReplyInput): Promise<CommentReply>;
  /**
   * Every comment matching the filters that existed at `snapshotAt`, newest first, read in keyset
   * pages of `batch` rows on (createdAt, id). Memory stays flat for any size (research R9).
   */
  iterateForExport(
    filters: ExportCommentsQueryInput,
    snapshotAt: Date,
    batch: number,
  ): AsyncGenerator<CommentRowWithClient>;
  /** Records that a download started (completed = false). Returns the record's id. */
  startExport(input: {
    actor: ExportActor;
    filters: ExportFilters;
  }): Promise<string>;
  /**
   * Retention (FR-049): deletes comments first classified before `cutoff`, in batches.
   * Returns how many it deleted.
   */
  purgeBefore(cutoff: Date, batch?: number): Promise<number>;
  /** Records how the download ended. */
  finishExport(id: string, rowCount: number, completed: boolean): Promise<void>;
}
