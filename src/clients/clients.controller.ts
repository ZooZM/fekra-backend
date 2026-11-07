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
import { ClientsService } from './clients.service';
import { BaseQueryDto } from '@app/common/dto/query-base.dto';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { CreateClientDto, UpdateClientDto } from './schemas/client.schema';
import { QueryClientDto } from './schemas/query-client.schema';
import { IdParamDto } from '@common/zod/dtos';

@Controller('clients')
@UseGuards(JwtAuthGuard)
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  create(@Body() dto: CreateClientDto) {
    return this.clientsService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryClientDto) {
    return this.clientsService.findAll(query);
  }

  // `:id` is the client's UUID (not its Facebook page / Instagram account id).
  // Validated here so a wrong id is a 422 before it reaches the database.

  @Get(':id')
  findById(@Param() { id }: IdParamDto) {
    return this.clientsService.findById(id);
  }

  @Patch(':id')
  update(@Param() { id }: IdParamDto, @Body() dto: UpdateClientDto) {
    return this.clientsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param() { id }: IdParamDto) {
    return this.clientsService.remove(id);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Put(':id/access-token')
  setAccessToken(@Param() { id }: IdParamDto, @Body('token') token: string) {
    return this.clientsService.setAccessToken(id, token);
  }
}
