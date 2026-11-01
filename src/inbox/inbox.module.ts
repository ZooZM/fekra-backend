// inbox/inbox.module.ts
import { Module } from '@nestjs/common';
import { redisProviders } from './redis.provider';
import { PriorityInboxService } from './priority-inbox.service';
import { DmBufferService } from './dm-buffer.service';
import { N8nDeliveryService } from './n8n-delivery.service';
import { ExpiryService } from './expiry.service';
import { N8nCallbackController } from './n8n-callback.controller';

@Module({
  controllers: [N8nCallbackController],
  providers: [
    ...redisProviders,
    PriorityInboxService,
    DmBufferService,
    N8nDeliveryService,
    ExpiryService,
  ],
  exports: [PriorityInboxService],
})
export class InboxModule {}
