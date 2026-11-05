// users/schemas/user.schema.ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { UserRole } from '@app/generated/prisma/client';
import { emailField, nameField, passwordField } from '@common/zod/primitives';
import { listQuery } from '@app/common/zod/list-query.schema';

const roles = z
  .array(z.enum(UserRole))
  .min(1)
  .transform((r) => [...new Set(r)]);

export const AdminCreateUserSchema = z.strictObject({
  name: nameField,
  email: emailField,
  password: passwordField,
  roles: roles.optional(),
  clientId: z.uuid().nullish(),
});

export const AdminUpdateUserSchema = AdminCreateUserSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'At least one field is required',
);

export const CreateUserSchema = z.strictObject({
  name: nameField,
  email: emailField,
  passwordHash: passwordField,
});

export const UpdateUserSchema = z
  .strictObject({ name: nameField })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'At least one field is required');

export const EmailParamSchema = z.strictObject({ email: emailField });

export const QueryUserSchema = listQuery(
  ['name', 'email', 'createdAt'],
  'createdAt',
).extend({
  email: z.string().trim().toLowerCase().max(255).optional(), // normalized like stored emails
  name: z.string().trim().min(1).max(255).optional(),
});

export class AdminCreateUserDto extends createZodDto(AdminCreateUserSchema) {}
export class AdminUpdateUserDto extends createZodDto(AdminUpdateUserSchema) {}
export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
export class EmailParamDto extends createZodDto(EmailParamSchema) {}
export class QueryUserDto extends createZodDto(QueryUserSchema) {}

export type AdminCreateUserInput = z.infer<typeof AdminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof AdminUpdateUserSchema>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export type QueryUserInput = z.infer<typeof QueryUserSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
