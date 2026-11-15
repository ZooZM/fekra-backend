import { createZodDto } from 'nestjs-zod';
import { ClientIdParamSchema, IdParamSchema } from './primitives';

export class IdParamDto extends createZodDto(IdParamSchema) {}

export class ClientIdParamDto extends createZodDto(ClientIdParamSchema) {}
