// meta-webhook.module.ts
import { Module } from '@nestjs/common';
import { MetaWebhookController } from './production/meta-webhook.controller';
import { MetaWebhookService } from './production/meta-webhook.service';
import { MetaSimulationController } from './dev/facebook/simulation/meta-simulation.controller';
import { MetaSimulationService } from './dev/facebook/simulation/meta-simulation.service';
import { MetaDashboardTestController } from './dev/facebook/dashboard-test/meta-dashboard-test.controller';
import { MetaDashboardTestService } from './dev/facebook/dashboard-test/meta-dashboard-test.service';
import { InstagramDashboardTestService } from './dev/instagram/dashboard-test/instagram-dashboard-test.service';
import { InstagramDashboardTestController } from './dev/instagram/dashboard-test/instagram-dashboard-test.controller';
import { InstagramSimulationController } from './dev/instagram/simulation/instagram-simulation.controller';
import { InstagramSimulationService } from './dev/instagram/simulation/instagram-simulation.service';
import { InstagramWebhookService } from './production/instagram-webhook.service';
import { InboxModule } from '@app/inbox/inbox.module';
import { ClientsModule } from '@app/clients/clients.module';

const isProd = process.env.NODE_ENV === 'production';

@Module({
  imports: [InboxModule, ClientsModule],
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
