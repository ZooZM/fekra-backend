import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { CurrentUser } from '@app/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { SafeUser } from '@app/users/types/safe-user.type';
import { ChatIdParamDto, QueryChatDto } from './schemas/chat.schema';
import { QueryMessageReplyDto } from './schemas/message-reply.schema';
import { ConversationsService } from './conversations.service';

@Controller('chats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'CLIENT')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOkResponse()
  findAll(@Query() query: QueryChatDto, @CurrentUser() user: SafeUser) {
    return this.conversations.findAll(query, user);
  }

  @Get(':chatId/messages')
  @ApiOkResponse()
  findMessages(
    @Param() { chatId }: ChatIdParamDto,
    @Query() query: QueryMessageReplyDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.conversations.findMessages(chatId, query, user);
  }
}
