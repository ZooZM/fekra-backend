import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateClientDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  businessCategory!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fbPageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  instaAccountId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  accessToken!: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  brandLogo?: string;

  @IsOptional()
  @IsObject()
  aiConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  dmReplyConfig?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  commentReplyConfig?: Record<string, unknown>;
}
