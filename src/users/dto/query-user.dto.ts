import { IsEmail, IsOptional, IsString } from 'class-validator';
import { BaseQueryDto } from '@app/common/dto/query-base.dto';

export class QueryUserDto extends BaseQueryDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
