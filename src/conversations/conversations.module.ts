import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { CONVERSATIONS_REPOSITORY } from './repositories/IConversationsRepository.repository';
import { ConversationsRepository } from './repositories/conversations.repository.impl';

@Module({
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    { provide: CONVERSATIONS_REPOSITORY, useClass: ConversationsRepository },
  ],
  exports: [ConversationsService],
})
export class ConversationsModule {}
