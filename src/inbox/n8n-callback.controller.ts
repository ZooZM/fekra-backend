// inbox/n8n-callback.controller.ts
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { N8nDeliveryService } from './n8n-delivery.service';
import { ConfigService } from '@nestjs/config';

@Controller('n8n')
export class N8nCallbackController {
  constructor(
    private readonly delivery: N8nDeliveryService,
    private readonly configService: ConfigService,
  ) {}

  @Post('callback')
  @HttpCode(200)
  async callback(
    @Body() body: { id?: string },
    @Headers('x-webhook-secret') secret: string | undefined,
  ) {
    const expected = this.configService.get<string>('N8N_WEBHOOK_SECRET');
    if (!expected || secret !== expected) throw new UnauthorizedException();
    if (!body?.id) throw new BadRequestException('id is required');

    return { acknowledged: await this.delivery.ack(body.id) };
  }
}
