import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersModule } from '@app/users/users.module';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtAuthGuard } from './guards/jwt.guard';
import { SessionService } from './session.service';
import { LoginThrottleService } from './login-throttle.service';
import { OriginGuard } from './guards/origin.guard';
import { SESSIONS_REPOSITORY } from './repositories/ISessionsRepository.repository';
import { SessionsRepository } from './repositories/sessions.repository.impl';

@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.getOrThrow<string>('JWT_EXPIRES_IN') as any,
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    SessionService,
    LoginThrottleService,
    OriginGuard,
    { provide: SESSIONS_REPOSITORY, useClass: SessionsRepository },
    LocalStrategy,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
  ],
  controllers: [AuthController],
  exports: [RolesGuard],
})
export class AuthModule {}
