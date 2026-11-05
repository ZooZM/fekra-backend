import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Put,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import {
  CreateServiceDto,
  UpdateServiceDto,
} from './schemas/service.schema';
import { QueryServiceDto } from './schemas/query-service.schema';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';

@Controller('services')
@UseGuards(JwtAuthGuard)
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
  findById(@Param('id') id: string) {
    return this.servicesService.findById(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServiceDto) {
    return this.servicesService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.servicesService.remove(id);
  }
}
