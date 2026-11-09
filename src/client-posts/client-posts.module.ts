// client-posts/client-posts.module.ts
import { Module } from '@nestjs/common';
import { ClientsModule } from '@app/clients/clients.module';
import { GraphApiModule } from '@app/inbox/graph-api.module';
import { InboxModule } from '@app/inbox/inbox.module';
import { ClientPostsController } from './client-posts.controller';
import { ClientPostsService } from './client-posts.service';

/** Owns no tables: reads posts from Meta and delegates comment rules and runs to `inbox`. */
@Module({
  imports: [ClientsModule, InboxModule, GraphApiModule],
  controllers: [ClientPostsController],
  providers: [ClientPostsService],
})
export class ClientPostsModule {}
