import { Hono } from 'hono';
import { deleteCookie, getCookie } from 'hono/cookie';
import type { AuthRepository } from './auth-repository';
import { requireTrustedOrigin } from './login-request';
import { type AuthEnv, requireSession } from './session-middleware';
import {
  type AuthOptions,
  SESSION_COOKIE_NAME,
  hashSessionToken,
  isValidSessionToken,
  sessionCookieOptions,
} from './session';

export function createSessionRoutes(repository: AuthRepository, options: AuthOptions) {
  const routes = new Hono<AuthEnv>();

  routes.get('/me', requireSession(repository, options), (c) => {
    return c.json({ user: c.get('user') });
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
