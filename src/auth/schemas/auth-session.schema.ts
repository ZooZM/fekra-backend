// auth/schemas/auth-session.schema.ts
// Response shape of login, refresh and register. Documentation and dashboard types only.
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const SafeUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  roles: z.array(z.enum(['ADMIN', 'CLIENT'])),
  clientId: z.string().nullish(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const AuthSessionSchema = z.object({
  user: SafeUserSchema,
  // access token: keep it in memory only, never in browser storage
  token: z.string(),
});

export class AuthSessionDto extends createZodDto(AuthSessionSchema) {}
