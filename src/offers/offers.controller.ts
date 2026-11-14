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
} from '@nestjs/common';
import { OffersService } from './offers.service';
import { CreateOfferDto, UpdateOfferDto } from './schemas/offer.schema';
import { QueryOfferDto } from './schemas/query-offer.schema';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { IdParamDto } from '@common/zod/dtos';

// ADMIN only until CLIENT users are scoped to their own clientId (constitution IV)
@Controller('offers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @Post()
  create(@Body() dto: CreateOfferDto) {
    return this.offersService.create(dto);
  }

  @Get()
  findAll(@Query() query: QueryOfferDto) {
    return this.offersService.findAll(query);
  }

  @Get(':id')
  findById(@Param() { id }: IdParamDto) {
    return this.offersService.findById(id);
  }

  @Patch(':id')
  update(@Param() { id }: IdParamDto, @Body() dto: UpdateOfferDto) {
    return this.offersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param() { id }: IdParamDto) {
    return this.offersService.remove(id);
  }
}
