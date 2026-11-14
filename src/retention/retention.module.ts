import { Module } from '@nestjs/common';
import { CommentsModule } from '@app/comments/comments.module';
import { ConversationsModule } from '@app/conversations/conversations.module';
import { RetentionService } from './retention.service';

/** A pipeline module: it owns no tables and deletes through the exported services. */
@Module({
  imports: [ConversationsModule, CommentsModule],
  providers: [RetentionService],
})
export class RetentionModule {}
