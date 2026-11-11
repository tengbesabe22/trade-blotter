# Trade Blotter

Small trading platform application that allows users to view and manage a trade blotter containing equity trades

```text
backend/    Hono + TypeScript API
frontend/   React + TypeScript + Vite
database/   Prisma models, client, migrations, and seeds
```

## Run the backend

Use Node 24.14.0 and pnpm 12.11.2. From the repository root:

```sh
pnpm install --frozen-lockfile
cp backend/.env.example backend/.env
pnpm dev
```

`GET http://localhost:3000/api/health` returns `{"status":"ok"}`.
Use `Copy-Item` instead of `cp` on PowerShell. Backend configuration comes from
`backend/.env` or injected environment variables; the database CLI still uses
`database/.env`. Root dev/build/typecheck commands build the database package first.

## Check and build

```sh
pnpm typecheck
pnpm build
pnpm start
```

GitHub Actions runs a frozen install, backend type check, login tests, and build on pushes
to main, pull requests, and manual dispatch. Backend session authentication is implemented; trade endpoints and the business UI are next.

## Local PostgreSQL and Prisma

PostgreSQL 18.6 runs in Docker; Prisma CLI/client are pinned to stable 7.10.1.
Start Docker Desktop first. From the repository root:

```sh
pnpm db:up
pnpm db:validate
```

For a fresh checkout, copy `database/.env.example` to `database/.env`
(`cp` on macOS/Linux or `Copy-Item` on PowerShell) before running Prisma.
The example credentials are for local development only. The connection is
`localhost:5432`; the Docker port binds only to the local machine.

- `pnpm db:up`: start PostgreSQL in the background and wait for health.
- `pnpm db:logs`: follow PostgreSQL logs; Ctrl+C stops following, not the database.
- `pnpm db:down`: stop containers while retaining the named data volume.
- `pnpm db:validate`: validate the Prisma schema/configuration.

The named volume is mounted at `/var/lib/postgresql`, as required by the
PostgreSQL 18 image. Removing the volume deletes its database data.
The schema and initial migration define instruments, accounts, sessions, trades,
outbox events, and idempotency requests.

## Seed local data

After applying migrations, run from the repository root:

```sh
pnpm db:seed
```

This generates Prisma Client and seeds 10 USD instruments, 3 individual trader
accounts, 1 read-only reviewer, and 500 synthetic trades. Trades include both
sides/statuses, fractional quantities, five execution dates, books/counterparties,
and some empty optional metadata. The first trade matches the AAPL example's
business fields; IDs use stable UUIDs. Prices and transactions are fictional.

| Email | Role |
| --- | --- |
| `jsmith@example.com` | Trader |
| `adoe@example.com` | Trader |
| `mlee@example.com` | Trader |
| `reviewer@example.com` | Read-only |

Local demo password for each account: `LocalDemo!2026`. The backend login endpoint is implemented. Passwords are stored as independently salted scrypt hashes:
`scrypt$N$r$p$saltHex$hashHex` (N=131072, r=8, p=1, 64-byte key).
The login verifier reads this format. These are local demo credentials.

Seeding is atomic and safe to rerun: existing instruments/accounts are preserved;
fixed trade IDs skip existing fixtures without overwriting amendments or
cancellations. No deletes or password resets occur. Sessions, outbox events,
and idempotency records are runtime data and are not seeded or cleared.

Database TypeScript check: `pnpm --filter @trade-blotter/database typecheck`
(after client generation, which `pnpm db:seed` performs).


## Backend authentication

With PostgreSQL migrated/seeded and the backend running, send:

```sh
curl -i -c .cookies http://localhost:3000/api/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  --data '{"email":"jsmith@example.com","password":"LocalDemo!2026"}'
```

The response is `{ "user": { "id": "...", "displayName": "JSMITH", "role": "TRADER" } }`
with an HttpOnly `blotter_session` cookie. Each login creates a fresh 32-byte random
token; only its SHA-256 hash is stored, with an eight-hour absolute expiry.
The server also rejects sessions after five minutes without authenticated activity.
Valid authenticated requests update `Session.lastSeenAt` without extending the
eight-hour maximum. Timing constants live in `backend/src/auth/session.ts`.
The browser uses the session cookie; no access/refresh-token pair is required.
[OWASP session expiry guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-expiration).

The cookie uses `SameSite=Lax`, `Path=/api`, and `Secure` in production.
Set `APP_ORIGIN` to the browser UI origin; production requires HTTPS. Login requires
JSON and an exact matching Origin header, including terminal clients.

Email is trimmed/lowercased; passwords are preserved exactly and verified with
the seeded scrypt format. Unknown accounts and wrong passwords receive the same
401 response; unknown accounts still perform a scrypt check. Login responses are
not cacheable. The local demo has no application-level login rate or concurrency
limiter; session records remain in PostgreSQL.

`GET /api/auth/me` returns the current database user/role or 401, clearing an
invalid or expired cookie. `POST /api/auth/logout` requires the trusted Origin,
deletes the current database session, clears its cookie, and returns 204.
Repeated logout is harmless. A copied/replayed cookie fails after logout.

After logging in with the cookie jar above:

```sh
curl -i -b .cookies -c .cookies http://localhost:3000/api/auth/me
curl -i -b .cookies -c .cookies -X POST http://localhost:3000/api/auth/logout \
  -H 'Origin: http://localhost:5173'
```

Startup wires the database client and `createAuthStore` adapter into the app.
Prisma queries live in `backend/src/auth/auth-store.ts`. `requireSession` validates
cookies and supplies the current user to route handlers. `requireTrader` provides
the role guard for upcoming trade writes; those routes must also check ownership.
Session activity updates use a conditional database write so concurrent logout
cannot revive a deleted session. Stream/background validation can pass
`{ recordActivity: false }`; SSE messages must not keep an idle session alive.
Stream connection cleanup will be connected when SSE is implemented.

The additive `add_session_last_seen_at` migration stores shared idle activity.
Run `pnpm db:migrate:dev` after updating a local checkout. Older sessions are
backfilled from creation time, so an old cookie may require a fresh login.

### Authentication tests

`pnpm test` runs password, login, session-expiry, logout, and role-guard tests.
Fake stores and an injectable clock keep these tests independent of PostgreSQL
and avoid waiting for actual timeouts.
`pnpm typecheck` checks source and test files. CI runs these checks and the builds.

### Production authentication

Use organizational federation through OIDC or SAML for sign-in while retaining
application-owned user IDs, database roles, and trade-ownership rules.
Enforce login throttling at the identity provider/API gateway with limits
consistent across backend instances, rather than process-local counters. If local
password login is retained, also bound password-verification load before public
exposure. These production controls are documented future work, not implemented
services. [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).


## Development workflow and AI use

New behavior follows test-driven development: failing test, minimal implementation,
then refactoring. Keep changes small, readable, and consistently terminated with
semicolons. Project guidance is in [AGENTS.md](AGENTS.md); selected AI contributions,
developer decisions, and verified results are in the [AI usage report](docs/ai-usage.md).


### Backend imports and build

Backend source and tests use extension-free local imports such as
`import { createApp } from './app';`. TypeScript uses `module: ESNext` and
`moduleResolution: Bundler` for checking; `tsx` runs source during development.
`backend/build.mjs` uses esbuild to bundle local modules into `dist/index.js`
for `pnpm start`. npm/workspace dependencies stay external; the database package
keeps its separate build. Changing TypeScript resolution alone would leave plain
Node ESM unable to load extension-free relative imports.
[TypeScript resolution](https://www.typescriptlang.org/tsconfig/#moduleResolution),
[esbuild package handling](https://esbuild.github.io/api/#packages).
