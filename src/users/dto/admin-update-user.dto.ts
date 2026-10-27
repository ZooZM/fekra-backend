import { AdminCreateUserDto } from './admin-create-user.dto';
import { PartialType } from '@nestjs/mapped-types';

export class AdminUpdateUserDto extends PartialType(AdminCreateUserDto) {}
