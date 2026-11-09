// client-posts/client-posts.controller.ts
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { IdParamDto } from '@common/zod/dtos';
import { ClientPostsService } from './client-posts.service';
import {
  ClientPostPageDto,
  UnrepliedCountDto,
} from './schemas/client-post-record.schema';
import {
  ClientPostParamsDto,
  ClientPostsQueryDto,
  UnrepliedCountQueryDto,
} from './schemas/client-posts-query.schema';

@Controller('clients/:id/posts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ClientPostsController {
  constructor(private readonly posts: ClientPostsService) {}

  /** One page of the client's posts on Facebook or Instagram, newest first. */
  @Get()
  @ApiOkResponse({ type: ClientPostPageDto })
  list(@Param() { id }: IdParamDto, @Query() query: ClientPostsQueryDto) {
    return this.posts.list(id, query);
  }

  /** Comments on one post that the account has not answered. A separate call, so the list stays fast. */
  @Get(':postId/unreplied-count')
  @ApiOkResponse({ type: UnrepliedCountDto })
  unrepliedCount(
    @Param() { id, postId }: ClientPostParamsDto,
    @Query() { platform }: UnrepliedCountQueryDto,
  ) {
    return this.posts.unrepliedCount(id, postId, platform);
  }
}
