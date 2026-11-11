import { createHash, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import type { LoginStore } from './login-store.js';
import {
  type LoginEnv,
  requireLoginRequest,
  loginBodyLimit,
  validateLoginCredentials,
} from './login-request.js';
import { dummyPasswordHash, verifyPassword } from './password.js';

// Cookies expect seconds; JavaScript dates expect milliseconds.
const SESSION_DURATION_HOURS = 8;
const SESSION_DURATION_SECONDS = SESSION_DURATION_HOURS * 60 * 60;
const SESSION_DURATION_MS = SESSION_DURATION_SECONDS * 1000;

export type LoginOptions = { origin: string; secureCookies: boolean };

export function createLoginRoutes(store: LoginStore, options: LoginOptions) {
  const routes = new Hono<LoginEnv>();

  routes.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });

  routes.post(
    '/login',
    requireLoginRequest(options.origin),
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

      await store.createSession({
        userId: user.id,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + SESSION_DURATION_MS),
      });

      // Persist first: a failed database write must never issue a session cookie.
      // The browser gets the raw token; the database stores only its hash.
      setCookie(c, 'blotter_session', token, {
        httpOnly: true,
        secure: options.secureCookies,
        sameSite: 'Lax',
        path: '/api',
        maxAge: SESSION_DURATION_SECONDS,
      });

      return c.json({ user: { id: user.id, displayName: user.displayName, role: user.role } });
    },
  );

  return routes;
}
