import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupOpenApi } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    // debug/verbose carry per-event detail (emails, message content): off in production
    logger:
      process.env.NODE_ENV === 'production'
        ? ['log', 'warn', 'error', 'fatal']
        : undefined,
  });

  configureApp(app);
  setupOpenApi(app);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
