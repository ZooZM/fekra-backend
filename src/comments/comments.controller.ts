import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { CurrentUser } from '@app/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { SafeUser } from '@app/users/types/safe-user.type';
import { QueryCommentReplyDto } from './schemas/comment-reply.schema';
import { CommentsService } from './comments.service';

@Controller('comment-replies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'CLIENT')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @ApiOkResponse()
  findAll(@Query() query: QueryCommentReplyDto, @CurrentUser() user: SafeUser) {
    return this.comments.findAll(query, user);
  }
}
