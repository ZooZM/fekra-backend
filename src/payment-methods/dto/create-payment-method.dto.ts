import {
  ArrayUnique,
  IsArray,
  IsString,
  IsUUID,
} from 'class-validator';

export class CreatePaymentMethodDto {
  @IsUUID()
  clientId!: string;
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  paymentMethods!: string[];
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  installmentOptions!: string[];
}
