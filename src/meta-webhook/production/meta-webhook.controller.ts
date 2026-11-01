// production/meta-webhook.controller.ts
import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { MetaWebhookService } from './meta-webhook.service';
import { MetaDashboardTestService } from '../dashboard-test/meta-dashboard-test.service';
import { MetaWebhookPayload } from '../types/meta-request.type';
import { InstagramWebhookService } from '../instagram/instagram-webhook.service';
import { InstagramDashboardTestService } from '../instagram/instagram-dashboard-test.service';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks/meta')
export class MetaWebhookController {
  constructor(
    private readonly webhookService: MetaWebhookService,
    private readonly dashboardTestService: MetaDashboardTestService,
    private readonly instagramService: InstagramWebhookService,
    private readonly instagramDashboardTest: InstagramDashboardTestService,
  ) {}

  @Post()
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): { received: true } {
    this.webhookService.verifySignature(request.rawBody, signature);

    const payload = request.body as MetaWebhookPayload;

    if (payload?.object === 'instagram') {
      if (this.instagramDashboardTest.isDashboardTest(payload)) {
        this.instagramDashboardTest.handle(payload);
      } else {
        this.instagramService.handleEvent(payload);
      }
      return { received: true };
    }

    if (this.dashboardTestService.isDashboardTest(payload)) {
      this.dashboardTestService.handle(payload);
    } else {
      this.webhookService.handleEvent(payload);
    }
    return { received: true };
  }
}
