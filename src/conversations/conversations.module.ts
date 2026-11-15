import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { CONVERSATIONS_REPOSITORY } from './repositories/IConversationsRepository.repository';
import { ConversationsRepository } from './repositories/conversations.repository.impl';
import { ChatPauseSweeper } from './chat-pause.sweeper';

@Module({
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    ChatPauseSweeper,
    { provide: CONVERSATIONS_REPOSITORY, useClass: ConversationsRepository },
  ],
  exports: [ConversationsService],
})
export class ConversationsModule {}
