// meta-webhook.module.ts
import { Module } from '@nestjs/common';
import { MetaWebhookController } from './production/meta-webhook.controller';
import { MetaWebhookService } from './production/meta-webhook.service';
import { MetaSimulationController } from './simulation/meta-simulation.controller';
import { MetaSimulationService } from './simulation/meta-simulation.service';
import { MetaDashboardTestController } from './dashboard-test/meta-dashboard-test.controller';
import { MetaDashboardTestService } from './dashboard-test/meta-dashboard-test.service';
import { InstagramDashboardTestService } from './instagram/instagram-dashboard-test.service';
import { InstagramDashboardTestController } from './instagram/instagram-dashboard-test.controller';
import { InstagramSimulationController } from './instagram/instagram-simulation.controller';
import { InstagramSimulationService } from './instagram/instagram-simulation.service';
import { InstagramWebhookService } from './instagram/instagram-webhook.service';
import { InboxModule } from '@app/inbox/inbox.module';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [InboxModule],
  controllers: [
    MetaWebhookController,
    ...(isProd
      ? []
      : [
          MetaSimulationController,
          MetaDashboardTestController,
          InstagramSimulationController,
          InstagramDashboardTestController,
        ]),
  ],
  providers: [
    MetaWebhookService,
    MetaSimulationService,
    MetaDashboardTestService,
    InstagramWebhookService,
    InstagramSimulationService,
    InstagramDashboardTestService,
  ],
})
export class MetaWebhookModule {}
