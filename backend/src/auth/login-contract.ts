import { z } from 'zod';

// Preserve existing login rules: extra fields are ignored and passwords stay unchanged.
export const loginRequestSchema = z.object({
  email: z.string()
    .trim()
    .toLowerCase()
    // Keep the existing format and UTF-16 length rule during this refactor.
    .refine(
      (email) => email.length <= 120 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
      'Provide a valid email.',
    ),
  password: z.string().refine(
    (password) => password.length > 0 && Buffer.byteLength(password, 'utf8') <= 1024,
    'Provide a nonempty password of at most 1024 UTF-8 bytes.',
  ),
});

export type LoginRequest = z.input<typeof loginRequestSchema>;
export type NormalizedLoginRequest = z.output<typeof loginRequestSchema>;
export type LoginEnv = { Variables: { credentials: NormalizedLoginRequest } };
