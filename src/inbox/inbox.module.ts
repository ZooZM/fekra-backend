// inbox/inbox.module.ts
import { forwardRef, Module } from '@nestjs/common';
import { redisProviders } from './redis.provider';
import { PriorityInboxService } from './priority-inbox.service';
import { DmBufferService } from './dm-buffer.service';
import { N8nDeliveryService } from './n8n-delivery.service';
import { ExpiryService } from './expiry.service';
import { N8nCallbackController } from './n8n-callback.controller';
import { ClientsModule } from '@app/clients/clients.module';
import { MessageSenderService } from './message-sender.service';
import { CommentReplyService } from './comment-reply.service';
import { AttachmentHandlerService } from './attachment-handler.service';
import { CommentClassifierService } from './comment-classifier.service';
import { CommentLlmClassifierService } from './comment-llm-classifier.service';
import { CommentBackfillService } from './comment-backfill.service';
import { PostCommentsService } from './post-comments.service';
import { BackfillRunStore } from './backfill-run.store';
import { CommentBackfillController } from './comment-backfill.controller';
import { GraphApiModule } from './graph-api.module';
import { CommentsModule } from '@app/comments/comments.module';
import { ConversationsModule } from '@app/conversations/conversations.module';

@Module({
  imports: [
    forwardRef(() => ClientsModule),
    GraphApiModule,
    CommentsModule,
    ConversationsModule,
  ],
  controllers: [N8nCallbackController, CommentBackfillController],
  providers: [
    ...redisProviders,
    PriorityInboxService,
    DmBufferService,
    N8nDeliveryService,
    ExpiryService,
    MessageSenderService,
    CommentReplyService,
    AttachmentHandlerService,
    CommentClassifierService,
    CommentLlmClassifierService,
    PostCommentsService,
    BackfillRunStore,
    CommentBackfillService,
  ],
  exports: [
    PriorityInboxService,
    CommentBackfillService,
    PostCommentsService,
    BackfillRunStore,
  ],
})
export class InboxModule {}
