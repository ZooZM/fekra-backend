// production/meta-webhook.controller.ts
import {
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  Query,
} from '@nestjs/common';
import { Request } from 'express';
import { MetaWebhookService } from './meta-webhook.service';
import { MetaWebhookPayload } from '../types/meta-webhook.types';
import { InstagramWebhookService } from './instagram-webhook.service';
// import {
//   isFacebookDashboardTest,
//   isInstagramDashboardTest,
// } from './dashboard-test-detector';

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks/meta')
export class MetaWebhookController {
  private readonly logger = new Logger(MetaWebhookController.name);

  constructor(
    private readonly webhookService: MetaWebhookService,
    private readonly instagramService: InstagramWebhookService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    this.webhookService.verifyChallenge(mode, token);
    return challenge ?? '';
  }

  @Post()
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): { received: true } {
    this.webhookService.verifySignature(request.rawBody, signature);

    const payload = request.body as MetaWebhookPayload;

    // if (payload?.object === 'instagram') {
    //   if (isInstagramDashboardTest(payload)) {
    //     this.logger.log('Ignoring Instagram dashboard test payload');
    //   } else {
    //     this.instagramService.handleEvent(payload);
    //   }
    //   return { received: true };
    // }

    // if (isFacebookDashboardTest(payload)) {
    //   this.logger.log('Ignoring Facebook dashboard test payload');
    // } else {
    //   this.webhookService.handleEvent(payload);
    // }
    // return { received: true };

    switch (payload?.object) {
      case 'page':
        this.webhookService.handleEvent(payload);
        break;
      case 'instagram':
        this.instagramService.handleEvent(payload);
        break;
      default:
        this.logger.debug(`Ignoring object type: ${payload?.object}`);
    }
    return { received: true };
  }
}
