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
to main, pull requests, and manual dispatch. Login is implemented; other authentication and trade endpoints are still to come.

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


## Backend login

With PostgreSQL migrated/seeded and the backend running, send:

```sh
curl -i http://localhost:3000/api/auth/login \
  -H 'Origin: http://localhost:5173' \
  -H 'Content-Type: application/json' \
  --data '{"email":"jsmith@example.com","password":"LocalDemo!2026"}'
```

The response is `{ "user": { "id": "...", "displayName": "JSMITH", "role": "TRADER" } }`
with an HttpOnly `blotter_session` cookie. Each login creates a fresh 32-byte random
token; only its SHA-256 hash is stored, with an eight-hour absolute expiry.
This is the session's hard maximum, not a short-lived OAuth access token. We keep
the database-session design for the first-party browser app. The agreed next auth
step adds a 15-minute idle timeout enforced by session-validation middleware;
that idle timeout is not implemented yet. Access/refresh tokens would add renewal,
rotation, and revocation handling and are not required for this session model.
[OWASP session expiry guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#session-expiration).

The cookie uses `SameSite=Lax`, `Path=/api`, and `Secure` in production.
Set `APP_ORIGIN` to the browser UI origin; production requires HTTPS. Login requires
JSON and an exact matching Origin header, including terminal clients.

Email is trimmed/lowercased; passwords are preserved exactly and verified with
the seeded scrypt format. Unknown accounts and wrong passwords receive the same
401 response; unknown accounts still perform a scrypt check. Login responses are
not cacheable. The local demo has no application-level login rate or concurrency
limiter; session records remain in PostgreSQL.

Run focused request tests with `pnpm test`. This slice only creates sessions:
`/api/auth/me`, logout, protected-route middleware, frontend login, and SSE session
handling will be separate steps. No schema change or migration is required here.

Startup wires the database client and `createLoginStore` adapter into the app.
Prisma queries live in `backend/src/auth/login-store.ts`; the route handles HTTP
and authentication. The typed store keeps request tests independent of PostgreSQL.

### Authentication tests

`pnpm test` runs 13 password/request tests using a fake store in memory.
These tests do not connect to PostgreSQL or need a running database.
`pnpm typecheck` checks source and test files. CI runs these checks and the builds.

### Production authentication

Use organizational federation through OIDC or SAML for sign-in while retaining
application-owned user IDs, database roles, and trade-ownership rules.
Enforce login throttling at the identity provider/API gateway with limits
consistent across backend instances, rather than process-local counters. If local
password login is retained, also bound password-verification load before public
exposure. These production controls are documented future work, not implemented
services. [OWASP authentication guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
