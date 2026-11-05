import {
  Controller,
  Get,
  Body,
  UseGuards,
  Param,
  Post,
  Put,
  Delete,
  Query,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { CurrentUser } from '@app/auth/decorators/current-user.decorator';
import {
  AdminCreateUserDto,
  AdminUpdateUserDto,
  QueryUserDto,
  UpdateUserDto,
} from './schemas/user.schema';
import { IdParamDto } from '@app/common/zod/dtos';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ───────────── Get ─────────────

  @Get('me')
  getMe(@CurrentUser('id') { id }: IdParamDto) {
    return this.usersService.findById(id);
  }

  @Get('admin')
  adminFindAll(@Query() query: QueryUserDto) {
    return this.usersService.findAll(query);
  }

  @Get('admin/:id')
  adminGetUserById(@Param('id') { id }: IdParamDto) {
    return this.usersService.findById(id);
  }

  // TODO: consider removing this endpoint and using the email param in the query instead
  // TODO: since this might cause errors handling the email param in the URL
  @Get('admin/email/:email')
  getUserByEmail(@Param('email') email: string) {
    return this.usersService.findByEmail(email);
  }

  // ───────────── Post ─────────────

  @Post('admin')
  adminCreate(@Body() dto: AdminCreateUserDto) {
    return this.usersService.adminCreate(dto);
  }

  // ───────────── Put ─────────────

  @Put('me')
  updateMe(@CurrentUser('id') { id }: IdParamDto, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto);
  }

  @Put('admin/:id')
  adminUpdate(
    @Param('id') { id }: IdParamDto,
    @Body() dto: AdminUpdateUserDto,
  ) {
    return this.usersService.adminUpdate(id, dto);
  }

  // ───────────── Delete ─────────────

  @Delete('admin/:id')
  adminDelete(@Param('id') { id }: IdParamDto) {
    return this.usersService.remove(id);
  }

  // @Post()
  // create(@Body() adminCreateUserDto: AdminCreateUserDto) {
  //   return this.usersService.create(adminCreateUserDto);
  // }

  // @Get()
  // findAll(@Query() query?: QueryUserDto) {
  //   return this.usersService.findAll(query);
  // }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.usersService.findById(id);
  // }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
  //   return this.usersService.update(id, updateUserDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: Types.ObjectId) {
  //   return this.usersService.remove(id);
  // }
}
