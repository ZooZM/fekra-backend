import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  UseGuards,
  Put,
} from '@nestjs/common';
import { BusinessInfoService } from './business-info.service';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { RolesGuard } from '@app/auth/guards/roles.guard';
import { Roles } from '@app/auth/decorators/roles.decorator';
import { CreateBusinessInfoDto } from './schemas/business-info.schema';

// ADMIN only until CLIENT users are scoped to their own clientId (constitution IV)
@Controller('business-info')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class BusinessInfoController {
  constructor(private readonly businessInfoService: BusinessInfoService) {}

  // TODO: should be a sub routes in clinet route, like /clients/:clientId/business-info
  @Post('client/:clientId')
  create(
    @Param('clientId') clientId: string,
    @Body() dto: CreateBusinessInfoDto,
  ) {
    const dtoWithClientId = { ...dto, clientId };
    return this.businessInfoService.create(dtoWithClientId);
  }

  @Get('client/:clientId')
  findByClientId(@Param('clientId') clientId: string) {
    return this.businessInfoService.findByClientId(clientId);
  }

  @Put('client/:clientId')
  updateByClientId(
    @Param('clientId') clientId: string,
    @Body() dto: CreateBusinessInfoDto,
  ) {
    return this.businessInfoService.update(clientId, dto);
  }

  @Delete('client/:clientId')
  removeByClientId(@Param('clientId') clientId: string) {
    return this.businessInfoService.remove(clientId);
  }
}
