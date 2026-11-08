// app.setup.ts
import {
  INestApplication,
  UnprocessableEntityException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ValidationError } from 'class-validator';
import { cleanupOpenApiDoc, ZodValidationPipe } from 'nestjs-zod';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import cookieParser = require('cookie-parser');

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

/** Comma-separated list → trimmed, non-empty entries. */
export const parseOrigins = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Shared by main.ts, the e2e tests and the OpenAPI export so they behave the same. */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);

  app.use(cookieParser());

  // CORS only for an explicit allowlist, never `*`. Empty in production: the dashboard is
  // served from the same origin through the reverse proxy.
  const origins = parseOrigins(config.get<string>('CORS_ORIGINS'));
  if (origins.length > 0) {
    app.enableCors({ origin: origins, credentials: true });
  }

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

  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: INestApplication) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Fekra API')
      .setOpenAPIVersion('3.1.0')
      .addBearerAuth()
      .build(),
  );
  return cleanupOpenApiDoc(document);
}

/** Serves /docs-json outside production (OPENAPI_ENABLED=false turns it off). */
export function setupOpenApi(app: INestApplication): void {
  const config = app.get(ConfigService);
  const enabled = config.get<string>('OPENAPI_ENABLED') !== 'false';
  if (config.get<string>('NODE_ENV') === 'production' || !enabled) return;
  SwaggerModule.setup('docs', app, buildOpenApiDocument(app));
}
