import { User } from '@app/generated/prisma/client';

export type SafeUser = Omit<
  User,
  'passwordHash' | 'resetTokenHash' | 'resetTokenExpiresAt'
>;

export type UserWithPassword = Omit<
  User,
  'resetTokenHash' | 'resetTokenExpiresAt'
>;
