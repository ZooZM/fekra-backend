import { IBaseRepository } from '@common/repositories/base.repository.interface';
import { UpdateUserData } from '../interfaces/update-user-data.interface';
import { CreateUserData } from '../interfaces/create-user-data.interface';
import { UserRole } from '@app/generated/prisma/client';
import {
  SafeUser,
  SafeUserWithPassword,
  SafeUserWithPasswordChangedAt,
} from '../types/safe-user.type';
import { QueryUserInput } from '../schemas/user.schema';

export const USERS_REPOSITORY = 'USERS_REPOSITORY';

export interface IUsersRepository extends IBaseRepository<
  SafeUser,
  CreateUserData,
  UpdateUserData,
  QueryUserInput
> {
  findByEmail(email: string): Promise<SafeUser | null>;
  findByEmailWithPassword(email: string): Promise<SafeUserWithPassword | null>;
  findByValidResetToken(tokenHash: string): Promise<SafeUser | null>;
  findByIdWithPassowrdChangedAt(
    id: string,
  ): Promise<SafeUserWithPasswordChangedAt | null>;

  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
  updateEmail(id: string, email: string): Promise<SafeUser>;
  setRoles(id: string, roles: UserRole[]): Promise<SafeUser>;
  setResetToken(id: string, tokenHash: string, expiresAt: Date): Promise<void>;
}
