import { createHash } from 'node:crypto';
import type { StoredSession } from './auth-contract';
import { SESSION_IDLE_TIMEOUT_MS } from './session-config';

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

// HTTP requests and open streams must enforce the same expiry boundaries.
export function isSessionActive(session: StoredSession | null, now: Date): session is StoredSession {
  return (
    session !== null &&
    session.expiresAt.getTime() > now.getTime() &&
    session.lastSeenAt.getTime() > now.getTime() - SESSION_IDLE_TIMEOUT_MS
  );
}
