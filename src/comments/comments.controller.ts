import {
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { CurrentUser } from '@app/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { SafeUser } from '@app/users/types/safe-user.type';
import {
  CommentPageDto,
  ExportCommentsQueryDto,
  QueryCommentReplyDto,
} from './schemas/comment-reply.schema';
import { CommentsService } from './comments.service';

@Controller('comment-replies')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'CLIENT')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Get()
  @ApiOkResponse({ type: CommentPageDto })
  findAll(@Query() query: QueryCommentReplyDto, @CurrentUser() user: SafeUser) {
    return this.comments.findAll(query, user);
  }

  // Customer text leaves the platform here, so it is ADMIN only (method-level @Roles overrides
  // the class-level ADMIN + CLIENT) and every call is recorded.
  @Get('export')
  @Roles('ADMIN')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({
    description:
      'A CSV of every matching comment (UTF-8 with BOM, streamed, no row limit)',
    content: { 'text/csv': { schema: { type: 'string' } } },
  })
  async export(
    @Query() query: ExportCommentsQueryDto,
    @CurrentUser() user: SafeUser,
  ): Promise<StreamableFile> {
    const { filename, stream } = await this.comments.export(query, user);
    return new StreamableFile(stream, {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${filename}"`,
    });
  }
}
