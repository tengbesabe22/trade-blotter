# Trade Blotter

A TypeScript application for viewing and recording USD equity trades.

**Working:** individual login/logout, database sessions, trade listing, and trade
creation with validation, idempotent retries, and transactional outbox storage.
Trade reads support bounded cursor pages, server sorting, and filtering.
Traders can amend or cancel their own ACTIVE trades through inline panels, with
ownership/version checks, immediate cache updates and SSE delivery.

**Next:** final acceptance checks, audit/summary extensions, and deployment.
The frontend supports login, session restoration, logout, and a read-only trade
grid with server sorting, Previous/Next pagination, manual refresh, and loading/empty/error states.
Ticker, Trader, Status, Side, Book, Counterparty and UTC date filters run on the
server and also apply to live events.
Ticker/trader options share the same cached lookup used by Create trade.
A row leaving the selection disappears immediately; a batched page fetch fills the gap.
The desktop workspace places sorting/filter controls and the default Create trade form
to the right of the grid. Amend/Cancel temporarily replace creation in that panel,
preserving its draft. Pending or unconfirmed creation blocks switching actions.
Create trade searches a cached instrument list by ticker/company name and requires
a valid selection. Successful creation refreshes the current page.
SSE inserts creation events directly into the default first-page cache. Other pages
and sorts retain their position; the new-trade notice appears only on older pages.
Ordering/membership changes batch for 100 ms before a background read of the same
page. Ordinary field edits need no read. A stale Next cursor stays disabled until
reconciliation supplies a fresh one; older pages retain their new-trade notice.

## Run locally

Use Node **24.14.0**, pnpm **12.11.2**, and a running Docker engine.
Run these commands from the repository root.

### 1. Install and configure

```sh
pnpm install --frozen-lockfile
cp backend/.env.example backend/.env
cp database/.env.example database/.env
```

On PowerShell, use `Copy-Item` in place of `cp`.
The API reads `backend/.env`; Prisma CLI commands read `database/.env`.
The examples point both to the same local database.

### 2. Prepare the database

```sh
pnpm db:up
pnpm db:migrate:dev
pnpm db:seed
```

PostgreSQL starts in the background on `localhost:5432`.
Seeding creates 10 instruments, 4 accounts, and 500 synthetic trades.
Rerunning the seed preserves existing records, passwords, and trade changes.

### 3. Start the API

```sh
pnpm dev
```

The API runs at `http://localhost:3000`.
Check `GET /api/health` for `{"status":"ok"}`.

Start the frontend in another terminal:

```sh
pnpm --filter @trade-blotter/frontend dev
```

Sign in with a demo account to view trades. The frontend uses the `/api` dev proxy.
See the [frontend guide](frontend/README.md) for the component and request flow.

## Demo accounts

All four accounts use the local demo password **`LocalDemo!2026`**.

| Email | Role |
| --- | --- |
| `jsmith@example.com` | Trader |
| `adoe@example.com` | Trader |
| `mlee@example.com` | Trader |
| `reviewer@example.com` | Read-only |

Both roles can list all trades. Only traders can create trades; ownership comes
from the session. Traders can amend only their own ACTIVE trades with the expected
version. Cancellation uses an inline confirmation panel with an optional reason;
cancelled rows remain visible and receive no further mutation actions.
All seeded trades and prices are fictional.

## API guide

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| POST | `/api/auth/login` | Sign in with email/password |
| GET | `/api/auth/me` | Read the current account and role |
| POST | `/api/auth/logout` | Revoke the current session |
| GET | `/api/trades` | Read a bounded, sortable/filterable cursor page |
| GET | `/api/trades/filter-options` | Read instrument/trader dropdown options |
| GET | `/api/events` | Stream trade changes with heartbeats and session checks |
| POST | `/api/trades` | Create a trade or replay its saved response |
| PATCH | `/api/trades/:id` | Amend an owned active trade |
| POST | `/api/trades/:id/cancel` | Cancel an owned active trade |

Start with [authentication and curl examples](docs/authentication.md), then
[listing trades](docs/trade-list-api.md), [creating a trade](docs/trade-create-api.md),
[amending trades](docs/trade-amend-api.md), [cancelling trades](docs/trade-cancel-api.md),
and the [SSE connection](docs/trade-stream-api.md).

## Checks and build

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @trade-blotter/frontend lint
pnpm --filter @trade-blotter/frontend build
```

Root typecheck/build commands build the database package first, then check/build
the backend. `pnpm test` runs both backend and frontend tests. `pnpm start` runs
the compiled API. Frontend lint/build are separate.

GitHub Actions runs these checks with a frozen install on pushes to `main`, pull
requests, and manual dispatch. Backend tests use fake repositories/database
operations; frontend API/component tests mock fetch. Neither needs a running PostgreSQL instance.

Live database concurrency/rollback verification and p50/p95 measurements remain
pending. Outbox records are stored; the relayer wakes after committed creates/amendments,
at startup and every second for recovery. SSE creation/amendment/cancellation delivery, heartbeats
and session checks are implemented for one backend process. Browser subscriptions
update the default first page directly and resynchronise the current page after
reconnection. Relevant ordering/membership changes also reconcile the current page
without moving the user to page one.

## Project map

| Location | Contents |
| --- | --- |
| `backend/` | Hono API, authentication, trade contracts, and repositories |
| `frontend/` | React auth/trade UI, API clients, AG Grid Community, TanStack Query, and Tailwind CSS |
| `database/` | Prisma schema/client, migrations, and rerun-safe seed |
| `docs/` | Authentication and trade API guides |

New behavior follows test-driven development. Keep changes small, readable, and
terminated with semicolons. See [AGENTS.md](AGENTS.md) for collaboration conventions.

Backend imports are extension-free. `tsx` runs development source; esbuild bundles
local modules for Node, keeping package dependencies external.

## Database commands

| Command | Use |
| --- | --- |
| `pnpm db:logs` | Follow PostgreSQL logs; Ctrl+C stops following |
| `pnpm db:down` | Stop containers while retaining database data |
| `pnpm db:validate` | Validate the Prisma schema/configuration |
| `pnpm db:migrate:create` | Generate a migration for review without applying it |
| `pnpm db:migrate:dev` | Apply migrations to the local development database |
| `pnpm db:studio` | Open Prisma Studio |

The named Docker volume preserves local data. Removing that volume deletes it.
