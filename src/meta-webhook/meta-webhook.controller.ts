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

type RawBodyRequest = Request & { rawBody?: Buffer };

@Controller('webhooks/meta')
export class MetaWebhookController {
  constructor(private readonly metaWebhookService: MetaWebhookService) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    this.metaWebhookService.verifyChallenge(mode, token);
    return challenge ?? '';
  }

  @Post()
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): { received: true } {
    this.metaWebhookService.verifySignature(request.rawBody, signature);
    this.metaWebhookService.handleEvent(request.body);
    return { received: true };
  }
}
