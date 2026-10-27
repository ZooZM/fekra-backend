import { UserRole } from '@app/generated/prisma/client';

export interface CreateUserData {
  name: string;
  email: string;
  passwordHash: string;
  roles?: UserRole[];
  clientId?: string | null;
}
