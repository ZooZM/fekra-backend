import {
  Controller,
  Get,
  Body,
  Patch,
  UseGuards,
  Param,
  Post,
  Put,
  Delete,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '@app/auth/guards/jwt.guard';
import { CurrentUser } from '@app/auth/decorators/current-user.decorator';
import { UpdateUserDto } from './dto/update-user.dto';
import { AdminCreateUserDto } from './dto/admin-create-user.dto';
import { AdminUpdateUserDto } from './dto/admin-update-user.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ───────────── Get ─────────────

  @Get('me')
  getMe(@CurrentUser('id') userId: string) {
    return this.usersService.findById(userId);
  }

  @Get('admin')
  adminFindAll() {
    return this.usersService.findAll();
  }

  @Get('admin/:id')
  adminGetUserById(@Param('id') userId: string) {
    return this.usersService.findById(userId);
  }

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
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(userId, dto);
  }

  @Put('admin/:id')
  adminUpdate(@Param('id') userId: string, @Body() dto: AdminUpdateUserDto) {
    return this.usersService.adminUpdate(userId, dto);
  }

  // ───────────── Delete ─────────────

  @Delete('admin/:id')
  adminDelete(@Param('id') userId: string) {
    return this.usersService.remove(userId);
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
