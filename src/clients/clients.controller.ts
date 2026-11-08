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
import { CurrentUser } from '@app/auth/decorators/current-user.decorator';
import { SafeUser } from '@app/users/types/safe-user.type';
import { ReplaceAccessTokenDto } from './schemas/access-token.schema';
import { ClientActor } from './types/client.types';
import { ClientsService } from './clients.service';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { CreateClientDto, UpdateClientDto } from './schemas/client.schema';
import { QueryClientDto } from './schemas/query-client.schema';
import { IdParamDto } from '@common/zod/dtos';
import { ApiCreatedResponse, ApiOkResponse } from '@nestjs/swagger';
import {
  ClientRecordDto,
  PaginatedClientsDto,
} from './schemas/client-record.schema';

const actorOf = (user: SafeUser): ClientActor => ({
  id: user.id,
  name: user.name,
  email: user.email,
});

@Controller('clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class ClientsController {
  constructor(private readonly clientsService: ClientsService) {}

  @Post()
  @ApiCreatedResponse({ type: ClientRecordDto })
  create(@Body() dto: CreateClientDto, @CurrentUser() user: SafeUser) {
    return this.clientsService.create(dto, actorOf(user));
  }

  @Get()
  @ApiOkResponse({ type: PaginatedClientsDto })
  findAll(@Query() query: QueryClientDto) {
    return this.clientsService.findAll(query);
  }

  // `:id` is the client's UUID (not its Facebook page / Instagram account id).
  // Validated here so a wrong id is a 422 before it reaches the database.

  @Get(':id')
  @ApiOkResponse({ type: ClientRecordDto })
  findById(@Param() { id }: IdParamDto) {
    return this.clientsService.findById(id);
  }

  @Patch(':id')
  @ApiOkResponse({ type: ClientRecordDto })
  update(
    @Param() { id }: IdParamDto,
    @Body() dto: UpdateClientDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.clientsService.update(id, dto, actorOf(user));
  }

  @Delete(':id')
  remove(@Param() { id }: IdParamDto, @CurrentUser() user: SafeUser) {
    return this.clientsService.remove(id, actorOf(user));
  }

  @Put(':id/access-token')
  setAccessToken(
    @Param() { id }: IdParamDto,
    @Body() { token }: ReplaceAccessTokenDto,
    @CurrentUser() user: SafeUser,
  ) {
    return this.clientsService.setAccessToken(id, token, actorOf(user));
  }
}
