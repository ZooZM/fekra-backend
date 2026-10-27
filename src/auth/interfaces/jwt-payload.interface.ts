import { UserRole } from '@app/generated/prisma/client';

export interface JwtPayload {
  sub: string;
  userRoles: UserRole[];
}
