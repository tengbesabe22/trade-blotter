# Trade Blotter

Small trading platform application that allows users to view and manage a trade blotter containing equity trades

```text
backend/    Hono + TypeScript Node.js starter
frontend/   React + TypeScript + Vite
database/   Prisma schema and configuration
```

## Run the backend

Use Node 24.14.0 and pnpm 12.11.2. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`GET http://localhost:3000/api/health` returns `{"status":"ok"}`.

## Check and build

```sh
pnpm typecheck
pnpm build
pnpm start
```

GitHub Actions runs a frozen install, backend type check, and build on pushes
to main, pull requests, and manual dispatch. Tests will be added alongside
application behavior; no business features are implemented yet.

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

Local demo password for each account: `LocalDemo!2026`. Login endpoints are not
implemented yet. Passwords are stored as independently salted scrypt hashes:
`scrypt$N$r$p$saltHex$hashHex` (N=131072, r=8, p=1, 64-byte key).
The future login verifier must read this format. These are local demo credentials.

Seeding is atomic and safe to rerun: existing instruments/accounts are preserved;
fixed trade IDs skip existing fixtures without overwriting amendments or
cancellations. No deletes or password resets occur. Sessions, outbox events,
and idempotency records are runtime data and are not seeded or cleared.

Database TypeScript check: `pnpm --filter @trade-blotter/database typecheck`
(after client generation, which `pnpm db:seed` performs).
