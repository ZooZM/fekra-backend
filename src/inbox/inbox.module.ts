// inbox/inbox.module.ts
import { Module } from '@nestjs/common';
import { redisProviders } from './redis.provider';
import { PriorityInboxService } from './priority-inbox.service';
import { DmBufferService } from './dm-buffer.service';
import { N8nDeliveryService } from './n8n-delivery.service';
import { ExpiryService } from './expiry.service';
import { N8nCallbackController } from './n8n-callback.controller';
import { ClientsModule } from '@app/clients/clients.module';
import { MessageSenderService } from './message-sender.service';
import { GraphApiService } from './graph-api.service';
import { CommentReplyService } from './comment-reply.service';
import { AttachmentHandlerService } from './attachment-handler.service';
import { CommentClassifierService } from './comment-classifier.service';

@Module({
  imports: [ClientsModule],
  controllers: [N8nCallbackController],
  providers: [
    ...redisProviders,
    PriorityInboxService,
    DmBufferService,
    N8nDeliveryService,
    ExpiryService,
    GraphApiService,
    MessageSenderService,
    CommentReplyService,
    AttachmentHandlerService,
    CommentClassifierService,
  ],
  exports: [PriorityInboxService],
})
export class InboxModule {}
