import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { AuthRepository, CurrentUser } from './auth-repository';
import {
  type AuthOptions,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_TIMEOUT_MS,
  hashSessionToken,
  isValidSessionToken,
  sessionCookieOptions,
} from './session';

export type AuthEnv = { Variables: { user: CurrentUser } };

type SessionBehavior = { recordActivity?: boolean };

export function requireSession(
  repository: AuthRepository,
  options: AuthOptions,
  behavior: SessionBehavior = {},
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    c.header('Cache-Control', 'no-store');

    const token = getCookie(c, SESSION_COOKIE_NAME);
    const tokenHash = isValidSessionToken(token) ? hashSessionToken(token) : null;
    const session = tokenHash ? await repository.findSession(tokenHash) : null;
    const now = options.now?.() ?? new Date();
    const idleCutoff = now.getTime() - SESSION_IDLE_TIMEOUT_MS;

    if (
      !tokenHash ||
      !session ||
      session.expiresAt.getTime() <= now.getTime() ||
      session.lastSeenAt.getTime() <= idleCutoff
    ) {
      deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions(options.secureCookies));

      return c.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, 401);
    }

    // Stream reconnects/background checks can validate without extending idle time.
    if (behavior.recordActivity !== false) {
      const updated = await repository.touchSession(tokenHash, now);

      if (!updated) {
        deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions(options.secureCookies));

        return c.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, 401);
      }
    }

    c.set('user', session.user);

    await next();
  };
}

// Trade write routes will use this after requireSession, then check ownership.
export const requireTrader: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.get('user').role !== 'TRADER') {
    return c.json({ code: 'FORBIDDEN', message: 'Trader access is required.' }, 403);
  }

  await next();
};
