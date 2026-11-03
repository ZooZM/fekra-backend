import { InboxModule } from '@app/inbox/inbox.module';
import { ClientsModule } from '@app/clients/clients.module';
import { Module } from '@nestjs/common';
import { MetaDashboardTestController } from './facebook/dashboard-test/meta-dashboard-test.controller';
import { MetaDashboardTestService } from './facebook/dashboard-test/meta-dashboard-test.service';
import { InstagramDashboardTestController } from './instagram/dashboard-test/instagram-dashboard-test.controller';
import { InstagramDashboardTestService } from './instagram/dashboard-test/instagram-dashboard-test.service';
import { InstagramSimulationController } from './instagram/simulation/instagram-simulation.controller';
import { InstagramSimulationService } from './instagram/simulation/instagram-simulation.service';
import { MetaSimulationController } from './facebook/simulation/meta-simulation.controller';
import { MetaSimulationService } from './facebook/simulation/meta-simulation.service';

// dev/meta-dev.module.ts
@Module({
  imports: [InboxModule, ClientsModule],
  controllers: [
    MetaSimulationController,
    MetaDashboardTestController,
    InstagramSimulationController,
    InstagramDashboardTestController,
  ],
  providers: [
    MetaSimulationService,
    MetaDashboardTestService,
    InstagramSimulationService,
    InstagramDashboardTestService,
  ],
})
export class MetaDevModule {}
