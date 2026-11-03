// dashboard-test/meta-dashboard-test.controller.ts
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { MetaDashboardTestService } from './meta-dashboard-test.service';
import { MetaSimulationService } from '../simulation/meta-simulation.service';

@Controller('webhooks/meta/dashboard-test')
export class MetaDashboardTestController {
  constructor(
    private readonly dashboardTest: MetaDashboardTestService,
    private readonly sim: MetaSimulationService,
  ) {}

  /** Last 20 dashboard Test payloads received (newest first). */
  @Get('captured')
  list() {
    return this.dashboardTest.list();
  }

  /** Re-send a captured payload (re-signed) to exercise the dashboard-test branch again. */
  @Post('replay/:index')
  replay(@Param('index', ParseIntPipe) index: number) {
    const item = this.dashboardTest.get(index);
    if (!item) throw new NotFoundException('No captured payload at that index');
    return this.sim.send(item.payload);
  }
}
