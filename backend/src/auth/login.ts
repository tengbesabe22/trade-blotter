import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AuthStore } from './auth-store';
import {
  type LoginEnv,
  requireTrustedOrigin,
  requireJsonLoginRequest,
  loginBodyLimit,
  validateLoginCredentials,
} from './login-request';
import { dummyPasswordHash, verifyPassword } from './password';

import {
  type AuthOptions,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_MS,
  hashSessionToken,
  sessionCookieOptions,
} from './session';

export function createLoginRoutes(store: AuthStore, options: AuthOptions) {
  const routes = new Hono<LoginEnv>();

  routes.post(
    '/login',
    requireTrustedOrigin(options.origin),
    requireJsonLoginRequest,
    loginBodyLimit,
    validateLoginCredentials,
    async (c) => {
      const { email, password } = c.get('credentials');

      const user = await store.findUser(email);

      // Unknown accounts still perform scrypt to reduce email-enumeration timing differences.
      const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);

      if (!user || !valid) {
        return c.json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, 401);
      }

      const token = randomBytes(32).toString('base64url');
      const now = options.now?.() ?? new Date();

      await store.createSession({
        userId: user.id,
        tokenHash: hashSessionToken(token),
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_MS),
      });

      // Persist first: a failed database write must never issue a session cookie.
      // The browser gets the raw token; the database stores only its hash.
      setCookie(c, SESSION_COOKIE_NAME, token, {
        ...sessionCookieOptions(options.secureCookies),
        maxAge: SESSION_MAX_AGE_SECONDS,
      });

      return c.json({ user: { id: user.id, displayName: user.displayName, role: user.role } });
    },
  );

  return routes;
}
