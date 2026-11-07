// inbox/comment-backfill.controller.ts
import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { CommentBackfillService } from './comment-backfill.service';
import { CommentBackfillDto } from './schemas/comment-backfill.schema';

@Controller('inbox/comments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class CommentBackfillController {
  constructor(private readonly backfill: CommentBackfillService) {}

  /**
   * Replies to the comments on a post that the page never answered.
   * 202: the comments are processed in the background, one every COMMENT_BACKFILL_DELAY_MS.
   */
  @Post('backfill')
  @HttpCode(202)
  start(@Body() dto: CommentBackfillDto) {
    return this.backfill.start(dto);
  }
}
