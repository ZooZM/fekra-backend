import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { parseOrigins } from '@app/app.setup';

/** Cookie-authenticated endpoints only accept requests that come from the dashboard origin. */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const origin = context.switchToHttp().getRequest<Request>().headers.origin;

    const allowed = [
      ...parseOrigins(this.config.get<string>('APP_ORIGIN')),
      ...parseOrigins(this.config.get<string>('CORS_ORIGINS')),
    ];
    if (!origin || !allowed.includes(origin)) {
      throw new ForbiddenException('Origin not allowed');
    }
    return true;
  }
}
