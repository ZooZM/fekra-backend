import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

/** The header n8n sends the shared secret in. */
export const N8N_SECRET_HEADER = 'x-webhook-secret';

/**
 * True when `provided` equals `expected`, compared in constant time so the response time cannot be
 * used to guess the secret (constitution IV). Different lengths are refused without comparing,
 * because timingSafeEqual needs equal lengths. Nothing matches when no secret is configured.
 */
export function secretMatches(
  provided: string | undefined,
  expected: string | undefined,
): boolean {
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * For the machine routes that only n8n calls (the chat callback, the lead endpoints): they take no
 * JWT, the caller proves itself with N8N_WEBHOOK_SECRET in the x-webhook-secret header. The secret
 * is read through ConfigService on every request (constitution VIII). Missing or wrong → 401.
 */
@Injectable()
export class N8nSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().headers[
      N8N_SECRET_HEADER
    ];
    // a header sent twice arrives as an array: never a valid secret
    const provided = typeof header === 'string' ? header : undefined;
    if (
      !secretMatches(provided, this.config.get<string>('N8N_WEBHOOK_SECRET'))
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
