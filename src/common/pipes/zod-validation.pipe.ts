// common/zod/zod-validation.pipe.ts
import {
  PipeTransform,
  Type,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createZodValidationPipe } from 'nestjs-zod';
import { z } from 'zod';

export const AppZodValidationPipe: Type<PipeTransform> =
  createZodValidationPipe({
    createValidationException: (error: unknown) =>
      new UnprocessableEntityException({
        message: 'Validation failed',
        errorCode: 'INPUT_VALIDATION_ERROR',
        details:
          error instanceof z.ZodError ? z.flattenError(error) : undefined,
      }),
  });
