import { createHash } from 'node:crypto';

// Change session timing here. Cookie Max-Age uses seconds; dates use milliseconds.
export const SESSION_MAX_DURATION_HOURS = 8;
export const SESSION_MAX_AGE_SECONDS = SESSION_MAX_DURATION_HOURS * 60 * 60;
export const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_SECONDS * 1000;

export const SESSION_IDLE_TIMEOUT_MINUTES = 5;
export const SESSION_IDLE_TIMEOUT_MS = SESSION_IDLE_TIMEOUT_MINUTES * 60 * 1000;
export const SESSION_COOKIE_NAME = 'blotter_session';

export type AuthOptions = {
  origin: string;
  secureCookies: boolean;
  now?: () => Date; // Tests supply a clock instead of waiting for timeouts.
};

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isValidSessionToken(token: string | undefined): token is string {
  return token !== undefined && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function sessionCookieOptions(secure: boolean) {
  // Login and logout must agree on the cookie path and security flags.
  return { httpOnly: true, secure, sameSite: 'Lax', path: '/api' } as const;
}
