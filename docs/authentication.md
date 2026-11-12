# Authentication

Individual email/password accounts use PostgreSQL-backed sessions.
Follow the [local setup](../README.md#run-locally) first.

## Sign in

These curl examples use a POSIX shell. On Windows, use WSL/Git Bash, or adapt
quoting and line continuations for PowerShell with `curl.exe`.

```sh
curl -i -c .cookies http://localhost:3000/api/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  --data '{"email":"jsmith@example.com","password":"LocalDemo!2026"}'
```

The response contains public account fields:

```json
{
  "user": {
    "id": "<account UUID>",
    "displayName": "JSMITH",
    "role": "TRADER"
  }
}
```

The server sets an HttpOnly `blotter_session` cookie. The browser sends it on
subsequent API requests; curl uses the `.cookies` file instead.

## Read the account or sign out

```sh
curl -i -b .cookies -c .cookies http://localhost:3000/api/auth/me

curl -i -b .cookies -c .cookies -X POST http://localhost:3000/api/auth/logout \
  -H 'Origin: http://localhost:5173'
```

`/me` returns the current database role, or `401` for an invalid/expired session.
Logout deletes the session and clears its cookie, returning `204`.
Repeating logout is harmless; the revoked cookie can no longer authenticate.

## Browser session restoration

Refreshing the page calls `/api/auth/me` with the browser's session cookie.
The UI waits for that check: a valid session restores the account, while `401`
shows login. Network/server failures offer retry instead of assuming logout.
Session checks are cancelled when obsolete; the frontend does not store tokens
or user records in local storage.

## Session rules

| Setting | Behavior |
| --- | --- |
| Maximum duration | 8 hours after login |
| Idle timeout | 5 minutes without authenticated activity |
| Activity | Renews idle time, never the maximum duration |
| Cookie | HttpOnly, SameSite=Lax, Path=/api; Secure in production |
| Token storage | Fresh random token per login; only its SHA-256 hash is stored |

Timing constants are in [session-config.ts](../backend/src/auth/session-config.ts).
Invalid/expired sessions clear the cookie and require login again.
Background/stream validation can avoid renewing idle time; stream cleanup will
be wired when SSE is implemented.

## Validation and permissions

- Login requires JSON and the exact configured `APP_ORIGIN` header. Logout and
  trade creation also require this trusted Origin, including for terminal clients.
- Emails are trimmed/lowercased. Password whitespace is preserved.
- Passwords use scrypt with an independent salt per password.
- Unknown emails and wrong passwords receive the same `401` response. Unknown
  accounts still perform a password check.
- Both roles can list all trades. `TRADER` can create as the logged-in account;
  `READ_ONLY` cannot write.

Authentication and trade responses use `Cache-Control: no-store`.

## Code map

All feature files are in `backend/src/auth/`:

| File | Responsibility |
| --- | --- |
| `auth-contract.ts` | Public user/response schemas and shared auth/session types |
| `login-contract.ts` | Login request validation, normalization, and inferred types |
| `auth-repository.ts` | Account and session queries |
| `auth-middleware.ts` | Session, role, and trusted-Origin guards |
| `login-middleware.ts` | JSON/body-size checks and parsing login credentials |
| `login-routes.ts` | Login handler and session creation |
| `session-routes.ts` | Current-user and logout handlers |
| `session-config.ts` | Session duration, idle timeout, and cookie name |
| `session-utils.ts` | Token hashing, token format, and cookie options |
| `password-utils.ts` | Password verification and dummy hash |

`LoginRequest` describes wire input; `NormalizedLoginRequest` describes parsed
credentials. Zod preserves the existing validation rules. Extra login fields are
ignored, and the account role always comes from the database.

`requireSession` supplies the current user; `requireTrader` restricts writes.
A conditional activity update prevents concurrent logout from reviving a session.

## Production plans

For production, consider organizational OIDC/SAML federation while retaining
application-owned user IDs and permissions. Add shared login throttling at the
identity provider or gateway and bound password-verification load. These controls
are planned; the local API has no custom login limiter. Production cookies require
HTTPS and an HTTPS `APP_ORIGIN`.

References: [session expiry](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-expiration)
and [authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
