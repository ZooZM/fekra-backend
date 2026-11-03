// instagram/instagram-simulation.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import {
  InstagramSimulationService,
  SimIgCommentOptions,
  SimIgDmOptions,
} from './instagram-simulation.service';
import { MetaWebhookPayload } from '../../../types/meta-webhook.types';

@Controller('webhooks/meta/simulate/instagram')
export class InstagramSimulationController {
  constructor(private readonly sim: InstagramSimulationService) {}

  @Post('comment')
  comment(@Body() opts: SimIgCommentOptions) {
    return this.sim.send(this.sim.buildComment(opts));
  }

  @Post('dm')
  dm(@Body() opts: SimIgDmOptions) {
    return this.sim.send(this.sim.buildDm(opts));
  }

  @Post('raw')
  raw(@Body() payload: MetaWebhookPayload) {
    return this.sim.send(payload);
  }
}
