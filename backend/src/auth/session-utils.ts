import { createHash } from 'node:crypto';

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
