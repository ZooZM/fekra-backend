import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { UserRole } from '@app/generated/prisma/client';
import { SafeUser } from '@app/users/types/safe-user.type';
import { PaginatedResult } from '@app/common/helpers/pagination.helper';
import { ExportFiltersSchema } from '@common/zod/json-columns.schema';
import {
  ExportCommentsQueryInput,
  QueryCommentReplyInput,
  SaveCommentReplySchema,
} from './schemas/comment-reply.schema';
import { CommentReply } from '@app/generated/prisma/client';
import {
  COMMENTS_REPOSITORY,
  ICommentsRepository,
} from './repositories/ICommentsRepository.repository';
import { toCommentRecord } from './mappers/comment.mapper';
import { CommentRecord } from './types/comment.types';
import { BOM, csvHeader, csvRow } from './comment-export.csv';

const DEFAULT_EXPORT_BATCH = 1000;

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    @Inject(COMMENTS_REPOSITORY) private readonly repo: ICommentsRepository,
    private readonly config: ConfigService,
  ) {}

  async findAll(
    query: QueryCommentReplyInput,
    user: SafeUser,
  ): Promise<PaginatedResult<CommentRecord>> {
    const page = await this.repo.findAll(
      query,
      this.scopeClientId(query.clientId, user),
    );
    return { ...page, data: page.data.map(toCommentRecord) };
  }

  save(input: z.input<typeof SaveCommentReplySchema>): Promise<CommentReply> {
    return this.repo.save(SaveCommentReplySchema.parse(input));
  }

  /**
   * A CSV of every comment matching the filters, streamed (research R9, R10).
   * The download is recorded before the first byte and finished when the stream ends, so a
   * download that is interrupted stays recorded as not completed.
   */
  async export(
    query: ExportCommentsQueryInput,
    user: SafeUser,
  ): Promise<{ filename: string; stream: Readable }> {
    const filters = {
      ...query,
      clientId: this.scopeClientId(query.clientId, user),
    };
    // Comments created after this instant are not in the file, so it matches the list's total
    const snapshotAt = new Date();
    const recordId = await this.repo.startExport({
      actor: { id: user.id, name: user.name, email: user.email },
      filters: ExportFiltersSchema.parse({
        ...(filters.clientId && { clientId: filters.clientId }),
        ...(filters.platform && { platform: filters.platform }),
        ...(filters.classification && {
          classification: filters.classification,
        }),
        ...(filters.decisionBasis && { decisionBasis: filters.decisionBasis }),
        ...(filters.from && { from: filters.from.toISOString() }),
        ...(filters.to && { to: filters.to.toISOString() }),
        snapshotAt: snapshotAt.toISOString(),
      }),
    });
    this.logger.log(`Comments export ${recordId} started by user ${user.id}`);

    return {
      filename: `comments-${stamp(snapshotAt)}.csv`,
      stream: Readable.from(
        this.csvChunks(recordId, filters, snapshotAt, this.batchSize()),
      ),
    };
  }

  /** Called by the retention run: deletes comments first classified before the cutoff. */
  purgeBefore(cutoff: Date): Promise<number> {
    return this.repo.purgeBefore(cutoff);
  }

  private async *csvChunks(
    recordId: string,
    filters: ExportCommentsQueryInput,
    snapshotAt: Date,
    batch: number,
  ): AsyncGenerator<string> {
    let rows = 0;
    let completed = false;
    try {
      yield BOM + csvHeader();
      for await (const row of this.repo.iterateForExport(
        filters,
        snapshotAt,
        batch,
      )) {
        yield csvRow(toCommentRecord(row));
        rows++;
      }
      completed = true;
    } finally {
      // runs when the stream ends, fails or is destroyed by a client that went away
      try {
        await this.repo.finishExport(recordId, rows, completed);
      } catch (err) {
        this.logger.error(
          `Could not finish export record ${recordId}: ${(err as Error).message}`,
        );
      }
      this.logger.log(
        `Comments export ${recordId} ${completed ? 'finished' : 'did not complete'}: ${rows} rows`,
      );
    }
  }

  private batchSize(): number {
    const configured = Number(this.config.get('COMMENT_EXPORT_BATCH'));
    return Number.isInteger(configured) && configured > 0
      ? configured
      : DEFAULT_EXPORT_BATCH;
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

/** yyyymmdd-hhmmss in UTC, for the file name. */
function stamp(date: Date): string {
  const iso = date.toISOString(); // 2026-11-14T15:30:12.345Z
  return `${iso.slice(0, 10).replace(/-/g, '')}-${iso.slice(11, 19).replace(/:/g, '')}`;
}
