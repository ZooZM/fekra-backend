import { UserRole } from '@app/generated/prisma/client';

export interface JwtPayload {
  sub: string;
  userRoles: UserRole[];
  /** Session id. Tokens without it (issued before sessions existed) stay valid until they expire. */
  sid?: string;
}
