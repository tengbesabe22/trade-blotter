import { z } from 'zod';

export const currentUserSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  role: z.enum(['TRADER', 'READ_ONLY']),
});

export type CurrentUser = z.infer<typeof currentUserSchema>;

export const authResponseSchema = z.object({ user: currentUserSchema });
export type AuthResponse = z.infer<typeof authResponseSchema>;

export type AuthEnv = { Variables: { user: CurrentUser } };

export type AuthOptions = {
  origin: string;
  secureCookies: boolean;
  now?: () => Date; // Tests supply a clock instead of waiting for timeouts.
};

// Internal persistence contracts use Dates; API responses expose only the user.
export type NewSession = {
  userId: string;
  tokenHash: string;
  lastSeenAt: Date;
  expiresAt: Date;
};

export type StoredSession = {
  user: CurrentUser;
  lastSeenAt: Date;
  expiresAt: Date;
};
