// simulation/meta-simulation.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import {
  MetaSimulationService,
  SimCommentOptions,
  SimDmOptions,
} from './meta-simulation.service';
import { MetaWebhookPayload } from '../../../types/meta-webhook.types';

@Controller('webhooks/meta/simulate')
export class MetaSimulationController {
  constructor(private readonly sim: MetaSimulationService) {}

  @Post('comment')
  comment(@Body() opts: SimCommentOptions) {
    return this.sim.send(this.sim.buildComment(opts));
  }

  @Post('dm')
  dm(@Body() opts: SimDmOptions) {
    return this.sim.send(this.sim.buildDm(opts));
  }

  /** Send any payload you want, signed. */
  @Post('raw')
  raw(@Body() payload: MetaWebhookPayload) {
    return this.sim.send(payload);
  }
}
