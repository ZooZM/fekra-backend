import { Module } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { GeneralExceptionsFilter } from './common/filters/general-exceptions.filter';
import { ClientsModule } from './clients/clients.module';
import { ServicesModule } from './services/services.module';
import { BusinessInfoModule } from './business-info/business-info.module';
import { OffersModule } from './offers/offers.module';
import { PrismaModule } from './prisma/prisma.module';
import { MetaWebhookModule } from './meta-webhook/meta-webhook.module';
import { InboxModule } from './inbox/inbox.module';
import { RedisModule } from './redis/redis.module';
import { HealthModule } from './health/health.module';
import { AppZodValidationPipe } from './common/pipes/zod-validation.pipe';
import { GraphApiModule } from './inbox/graph-api.module';

function devModules() {
  if (process.env.NODE_ENV === 'production') return [];
  try {
    // loaded only outside production, so the dev module is not part of the production build graph
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return [require('./meta-webhook/dev/meta-dev.module').MetaDevModule];
  } catch {
    return []; // folder not present, nothing to load
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env.development.local',
    }),
    PrismaModule,
    RedisModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ClientsModule,
    ServicesModule,
    BusinessInfoModule,
    OffersModule,
    InboxModule,
    MetaWebhookModule,
    GraphApiModule,
    ...devModules(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_PIPE,
      useClass: AppZodValidationPipe,
    },
    {
      provide: APP_FILTER,
      useClass: GeneralExceptionsFilter,
    },
  ],
})
export class AppModule {}
