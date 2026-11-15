import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { CurrentUser } from '@app/auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { SafeUser } from '@app/users/types/safe-user.type';
import {
  ChatIdParamDto,
  ChatPageDto,
  ChatRecordDto,
  PauseChatDto,
  QueryChatDto,
} from './schemas/chat.schema';
import {
  ExchangePageDto,
  QueryMessageReplyDto,
} from './schemas/message-reply.schema';
import { ConversationsService } from './conversations.service';

@Controller('chats')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'CLIENT')
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOkResponse({ type: ChatPageDto })
  findAll(@Query() query: QueryChatDto, @CurrentUser() user: SafeUser) {
    return this.conversations.findAll(query, user);
  }

  @Get(':chatId')
  @ApiOkResponse({ type: ChatRecordDto })
  findOne(@Param() { chatId }: ChatIdParamDto, @CurrentUser() user: SafeUser) {
    return this.conversations.findOne(chatId, user);
  }

  @Get(':chatId/messages')
  @ApiOkResponse({ type: ExchangePageDto })
  findMessages(
    @Param() { chatId }: ChatIdParamDto,
    @Query() query: QueryMessageReplyDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.conversations.findMessages(chatId, query, user);
  }

  // Method-level @Roles overrides the class-level ADMIN + CLIENT (RolesGuard uses getAllAndOverride)
  @Post(':chatId/pause')
  @HttpCode(200)
  @Roles('ADMIN')
  @ApiOkResponse({ type: ChatRecordDto })
  pause(
    @Param() { chatId }: ChatIdParamDto,
    @Body() dto: PauseChatDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.conversations.pause(chatId, dto, user);
  }

  @Post(':chatId/resume')
  @HttpCode(200)
  @Roles('ADMIN')
  @ApiOkResponse({ type: ChatRecordDto })
  resume(@Param() { chatId }: ChatIdParamDto, @CurrentUser() user: SafeUser) {
    return this.conversations.resume(chatId, user);
  }
}
