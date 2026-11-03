import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
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

function devModules() {
  if (process.env.NODE_ENV === 'production') return [];
  try {
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
    UsersModule,
    AuthModule,
    ClientsModule,
    ServicesModule,
    BusinessInfoModule,
    OffersModule,
    InboxModule,
    MetaWebhookModule,
    ...devModules(),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: GeneralExceptionsFilter,
    },
  ],
})
export class AppModule {}
