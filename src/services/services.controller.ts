import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Query,
  UseGuards,
  Put,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto, UpdateServiceDto } from './schemas/service.schema';
import { QueryServiceDto } from './schemas/query-service.schema';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { IdParamDto } from '@common/zod/dtos';

// ADMIN only until CLIENT users are scoped to their own clientId (constitution IV)
@Controller('services')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Post()
  create(@Body() dto: CreateServiceDto) {
    return this.servicesService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryServiceDto) {
    return this.servicesService.findAll(query);
  }

  @Get(':id')
  findById(@Param() { id }: IdParamDto) {
    return this.servicesService.findById(id);
  }

  @Put(':id')
  update(@Param() { id }: IdParamDto, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param() { id }: IdParamDto) {
    return this.servicesService.remove(id);
  }
}
