import { Module } from '@nestjs/common';
import { ClientsModule } from '@app/clients/clients.module';
import { ConversationsModule } from '@app/conversations/conversations.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';
import { LEADS_REPOSITORY } from './repositories/ILeadsRepository.repository';
import { LeadsRepository } from './repositories/leads.repository.impl';

@Module({
  imports: [ClientsModule, ConversationsModule],
  controllers: [LeadsController],
  providers: [
    LeadsService,
    { provide: LEADS_REPOSITORY, useClass: LeadsRepository },
  ],
  exports: [LeadsService], // the retention run deletes old leads through it
})
export class LeadsModule {}
