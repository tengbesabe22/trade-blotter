import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { AuthRepository } from './auth-repository';
import type { AuthEnv, AuthOptions } from './auth-contract';
import { SESSION_COOKIE_NAME } from './session-config';
import {
  hashSessionToken,
  isSessionActive,
  isValidSessionToken,
  sessionCookieOptions,
} from './session-utils';

export function requireTrustedOrigin(origin: string): MiddlewareHandler {
  return async (c, next) => {
    // Cookies travel automatically: reject requests from other sites to prevent cross-site login/logout requests.
    if (c.req.header('Origin') !== origin) {
      return c.json({ code: 'FORBIDDEN_ORIGIN', message: 'Request origin is not allowed.' }, 403);
    }

    await next();
  };
}

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

    if (!tokenHash || !isSessionActive(session, now)) {
      deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions(options.secureCookies));

      return c.json({ code: 'UNAUTHENTICATED', message: 'Please log in again.' }, 401);
    }

    // This hint only suppresses activity writes; authentication/expiry checks above still apply.
    const shouldRecordActivity = behavior.recordActivity !== false &&
      c.req.header('X-Session-Activity') !== 'background';

    if (shouldRecordActivity) {
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

// Use after requireSession; amendment/cancellation handlers also check ownership.
export const requireTrader: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.get('user').role !== 'TRADER') {
    return c.json({ code: 'FORBIDDEN', message: 'Trader access is required.' }, 403);
  }

  await next();
};
