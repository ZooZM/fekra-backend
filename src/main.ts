import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp, setupOpenApi } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });

  configureApp(app);
  setupOpenApi(app);

  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
