// instagram/instagram-dashboard-test.controller.ts
import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { InstagramDashboardTestService } from './instagram-dashboard-test.service';
import { InstagramSimulationService } from '../simulation/instagram-simulation.service';

@Controller('webhooks/meta/dashboard-test/instagram')
export class InstagramDashboardTestController {
  constructor(
    private readonly dashboardTest: InstagramDashboardTestService,
    private readonly sim: InstagramSimulationService,
  ) {}

  @Get('captured')
  list() {
    return this.dashboardTest.list();
  }

  @Post('replay/:index')
  replay(@Param('index', ParseIntPipe) index: number) {
    const item = this.dashboardTest.get(index);
    if (!item) throw new NotFoundException('No captured payload at that index');
    return this.sim.send(item.payload);
  }
}
