import { User } from '@app/generated/prisma/client';

export type SafeUser = Omit<
  User,
  | 'passwordHash'
  | 'passwordChangedAt'
  | 'resetTokenHash'
  | 'resetTokenExpiresAt'
>;

export type SafeUserWithPassword = Omit<
  User,
  'passwordChangedAt' | 'resetTokenHash' | 'resetTokenExpiresAt'
>;

export type SafeUserWithPasswordChangedAt = Omit<
  User,
  'passwordHash' | 'resetTokenHash' | 'resetTokenExpiresAt'
>;
