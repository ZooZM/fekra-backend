import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse } from '@nestjs/swagger';
import {
  N8N_SECRET_HEADER,
  N8nSecretGuard,
} from '@common/guards/n8n-secret.guard';
import {
  LeadContextDto,
  LeadContextQueryDto,
  UpsertLeadDto,
  UpsertLeadResultDto,
} from './schemas/lead.schema';
import { LeadsService } from './leads.service';

/**
 * Machine routes for the n8n chat workflows (feature 004). No JWT on purpose: only n8n calls them,
 * and it authenticates with the shared secret like the n8n callback (constitution IV). The guard
 * runs before validation, so a request without the secret learns nothing about the input rules.
 */
@Controller('n8n/leads')
@UseGuards(N8nSecretGuard)
@ApiHeader({
  name: N8N_SECRET_HEADER,
  required: true,
  description: 'Must equal N8N_WEBHOOK_SECRET',
})
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get('context')
  @ApiOkResponse({ type: LeadContextDto })
  context(@Query() query: LeadContextQueryDto) {
    return this.leads.context(query);
  }

  @Post()
  @HttpCode(200)
  @ApiOkResponse({ type: UpsertLeadResultDto })
  upsert(@Body() dto: UpsertLeadDto) {
    return this.leads.upsert(dto);
  }
}
