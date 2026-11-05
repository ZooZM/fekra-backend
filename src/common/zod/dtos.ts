import { createZodDto } from 'nestjs-zod';
import { IdParamSchema } from './primitives';

export class IdParamDto extends createZodDto(IdParamSchema) {}
