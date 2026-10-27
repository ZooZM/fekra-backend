import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNumber,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { DiscountType } from '@app/generated/prisma/enums';

export class CreateOfferDto {
  @IsUUID()
  clientId!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  title!: string;
  @IsString()
  @MaxLength(255)
  description?: string;
  @IsEnum(DiscountType)
  discountType!: DiscountType;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  discountValue!: number;
  @Type(() => Date)
  @IsDate()
  startDate!: Date;
  @Type(() => Date)
  @IsDate()
  endDate!: Date;
}
