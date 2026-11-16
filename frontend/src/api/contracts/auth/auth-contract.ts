import { z } from 'zod';

export const loginRequestSchema = z.object({
  email: z.string(),
  password: z.string(),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const currentUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  role: z.enum(['TRADER', 'READ_ONLY']),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
export const authResponseSchema = z.object({ user: currentUserSchema });
export type AuthResponse = z.infer<typeof authResponseSchema>;
