import { IBaseRepository } from '@common/repositories/base.repository.interface';
import { UpdateUserData } from '../interfaces/update-user-data.interface';
import { CreateUserData } from '../interfaces/create-user-data.interface';
import { UserRole } from '@app/generated/prisma/client';
import { SafeUser, UserWithPassword } from '../types/safe-user.type';

export const USERS_REPOSITORY = 'USERS_REPOSITORY';

export interface IUsersRepository extends IBaseRepository<
  SafeUser,
  CreateUserData,
  UpdateUserData
> {
  findByEmail(email: string): Promise<SafeUser | null>;
  findByEmailWithPassword(email: string): Promise<UserWithPassword | null>;
  findByValidResetToken(tokenHash: string): Promise<SafeUser | null>;

  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  updateEmail(id: string, email: string): Promise<SafeUser>;
  setRoles(id: string, roles: UserRole[]): Promise<SafeUser>;
  setResetToken(id: string, tokenHash: string, expiresAt: Date): Promise<void>;
}
