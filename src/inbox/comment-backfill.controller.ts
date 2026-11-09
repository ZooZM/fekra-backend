// inbox/comment-backfill.controller.ts
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiAcceptedResponse, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { CurrentUser } from '@app/auth/decorators/current-user.decorator';
import { ClientActor } from '@app/clients/types/client.types';
import { SafeUser } from '@app/users/types/safe-user.type';
import { IdParamDto } from '@common/zod/dtos';
import { CommentBackfillService } from './comment-backfill.service';
import {
  BackfillRunDto,
  BackfillStartResultDto,
  CommentBackfillDto,
} from './schemas/comment-backfill.schema';

/** Only the admin's identity goes on: it names them in the activity record. */
const actorOf = (user: SafeUser): ClientActor => ({
  id: user.id,
  name: user.name,
  email: user.email,
});

@Controller('inbox/comments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class CommentBackfillController {
  constructor(private readonly backfill: CommentBackfillService) {}

  /**
   * Replies to the comments on a post that the page never answered.
   * 202: the comments are processed in the background, one every COMMENT_BACKFILL_DELAY_MS.
   * The body has the run to follow; it is null when nothing needs a reply.
   */
  @Post('backfill')
  @HttpCode(202)
  @ApiAcceptedResponse({ type: BackfillStartResultDto })
  start(@Body() dto: CommentBackfillDto, @CurrentUser() user: SafeUser) {
    return this.backfill.start(dto, actorOf(user));
  }

  /** A run's progress ("handled X of N") or its outcome, for 24 hours after it ends. */
  @Get('backfill/runs/:id')
  @ApiOkResponse({ type: BackfillRunDto })
  getRun(@Param() { id }: IdParamDto) {
    return this.backfill.getRun(id);
  }

  /** Stops a run: no further comment is started, and the one in progress is completed. */
  @Post('backfill/runs/:id/stop')
  @HttpCode(200)
  @ApiOkResponse({ type: BackfillRunDto })
  stopRun(@Param() { id }: IdParamDto, @CurrentUser() user: SafeUser) {
    return this.backfill.stopRun(id, actorOf(user));
  }
}
