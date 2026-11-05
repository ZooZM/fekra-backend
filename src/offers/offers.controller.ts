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
import {
  CreateOfferDto,
  UpdateOfferDto,
} from './schemas/offer.schema';
import { QueryOfferDto } from './schemas/query-offer.schema';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';

@Controller('offers')
@UseGuards(JwtAuthGuard)
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
  findById(@Param('id') id: string) {
    return this.offersService.findById(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOfferDto) {
    return this.offersService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.offersService.remove(id);
  }
}
