import { NestFactory } from '@nestjs/core';
import { UnprocessableEntityException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import { AppModule } from './app.module';
import { ZodValidationPipe } from 'nestjs-zod';

const flatten = (
  errors: ValidationError[],
  parent = '',
): Record<string, string[]> =>
  errors.reduce<Record<string, string[]>>((acc, e) => {
    const path = parent ? `${parent}.${e.property}` : e.property;
    if (e.constraints) acc[path] = Object.values(e.constraints);
    if (e.children?.length) Object.assign(acc, flatten(e.children, path));
    return acc;
  }, {});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  app.useGlobalPipes(
    new ZodValidationPipe(),
    new ValidationPipe({
      exceptionFactory: (errors) =>
        new UnprocessableEntityException({
          message: 'Validation failed',
          errorCode: 'INPUT_VALIDATION_ERROR',
          details: flatten(errors),
        }),
    }),
  );

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
