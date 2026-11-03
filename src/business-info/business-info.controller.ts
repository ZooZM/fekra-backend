import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { BusinessInfoService } from './business-info.service';
import { CreateBusinessInfoDto } from './dto/create-business-info.dto';
import { UpdateBusinessInfoDto } from './dto/update-business-info.dto';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';

@Controller('business-info')
@UseGuards(JwtAuthGuard)
export class BusinessInfoController {
  constructor(private readonly businessInfoService: BusinessInfoService) {}

  @Post()
  create(@Body() createBusinessInfoDto: CreateBusinessInfoDto) {
    return this.businessInfoService.create(createBusinessInfoDto);
  }

  @Get()
  findAll() {
    return this.businessInfoService.findAll();
  }

  @Get(':id')
  findByClientId(@Param('id') id: string) {
    return this.businessInfoService.findByClientId(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBusinessInfoDto: UpdateBusinessInfoDto,
  ) {
    return this.businessInfoService.update(id, updateBusinessInfoDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.businessInfoService.remove(id);
  }
}
