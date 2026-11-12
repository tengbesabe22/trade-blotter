import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { AuthRepository } from './auth-repository';
import type { AuthOptions, AuthResponse } from './auth-contract';
import type { LoginEnv } from './login-contract';
import { requireTrustedOrigin } from './auth-middleware';
import {
  requireJsonLoginRequest,
  loginBodyLimit,
  validateLoginCredentials,
} from './login-middleware';
import { dummyPasswordHash, verifyPassword } from './password-utils';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  SESSION_MAX_AGE_MS,
} from './session-config';
import { hashSessionToken, sessionCookieOptions } from './session-utils';

export function createLoginRoutes(repository: AuthRepository, options: AuthOptions) {
  const routes = new Hono<LoginEnv>();

  routes.post(
    '/login',
    requireTrustedOrigin(options.origin),
    requireJsonLoginRequest,
    loginBodyLimit,
    validateLoginCredentials,
    async (c) => {
      const { email, password } = c.get('credentials');

      const user = await repository.findUser(email);

      // Unknown accounts still perform scrypt to reduce email-enumeration timing differences.
      const valid = await verifyPassword(password, user?.passwordHash ?? dummyPasswordHash);

      if (!user || !valid) {
        return c.json({ code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' }, 401);
      }

      const token = randomBytes(32).toString('base64url');
      const now = options.now?.() ?? new Date();

      await repository.createSession({
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

      const response: AuthResponse = {
        user: { id: user.id, displayName: user.displayName, role: user.role },
      };

      return c.json(response);
    },
  );

  return routes;
}
