import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
} from 'class-validator';

export class CreateBusinessInfoDto {
  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  whatsapp?: string;

  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  website?: string;

  @IsOptional()
  @IsArray()
  socialMedia?: Record<string, unknown>[];

  @IsOptional()
  @IsObject()
  location?: Record<string, unknown>;

  @IsOptional()
  workHours?: Record<string, unknown> | Record<string, unknown>[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  paymentMethods?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  installmentOptions?: string[];
}
