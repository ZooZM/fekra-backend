import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateServiceDto {
  @IsUUID() clientId!: string;
  @IsString() @MinLength(1) @MaxLength(255) name!: string;
  @IsOptional() @IsString() @MaxLength(255) description?: string;
  @IsOptional() @IsString() @MaxLength(255) price?: string;
  @IsOptional() @IsObject() variants?: Record<string, unknown>;
  @IsOptional() @IsUUID() offerId?: string;
}
