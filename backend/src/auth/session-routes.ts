import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { AuthRepository } from './auth-repository';
import type { AuthEnv, AuthOptions, AuthResponse } from './auth-contract';
import { requireTrustedOrigin, requireSession } from './auth-middleware';
import { SESSION_COOKIE_NAME } from './session-config';
import { hashSessionToken, isValidSessionToken, sessionCookieOptions } from './session-utils';

export function createSessionRoutes(repository: AuthRepository, options: AuthOptions) {
  const routes = new Hono<AuthEnv>();

  routes.get('/me', requireSession(repository, options), (c) => {
    const response: AuthResponse = { user: c.get('user') };

    return c.json(response);
  });

  routes.post('/logout', requireTrustedOrigin(options.origin), async (c) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);

    if (isValidSessionToken(token)) {
      // Delete server-side first; clearing a cookie alone does not revoke a session.
      await repository.deleteSession(hashSessionToken(token));
    }

    deleteCookie(c, SESSION_COOKIE_NAME, sessionCookieOptions(options.secureCookies));

    return c.body(null, 204);
  });

  return routes;
}
