import { PartialType } from '@nestjs/mapped-types';
import { CreateBusinessInfoDto } from './create-business-info.dto';

export class UpdateBusinessInfoDto extends PartialType(CreateBusinessInfoDto) {}
