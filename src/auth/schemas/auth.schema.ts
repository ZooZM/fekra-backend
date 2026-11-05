// auth/schemas/auth.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { emailField, nameField, passwordField } from '@common/zod/primitives';

// Login only checks that a value was sent. Strength rules apply when the password is set,
// so an older, shorter password isn't rejected before the credential check, and the
// error doesn't reveal the password policy.
export const LoginSchema = z.strictObject({
  email: emailField,
  password: passwordField,
});

// Public registration: no roles, no clientId
export const RegisterUserSchema = z.strictObject({
  name: nameField,
  email: emailField,
  password: passwordField,
});

export class LoginDto extends createZodDto(LoginSchema) {}
export class RegisterUserDto extends createZodDto(RegisterUserSchema) {}

export type LoginInput = z.infer<typeof LoginSchema>;
export type RegisterUserInput = z.infer<typeof RegisterUserSchema>;
