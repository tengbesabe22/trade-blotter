# Trade Blotter

A USD equities workspace for recording trades, following live changes and viewing
current desk positions. React/TypeScript, Vite, Tailwind, AG Grid and TanStack Query
connect to a Hono/TypeScript API backed by Prisma and PostgreSQL. Zod validates
API request and response contracts.

## Scope

- Individual trader and read-only accounts; traders amend/cancel only their own ACTIVE trades.
- Server-side sorting/filtering, cursor pages, creation, amendments and cancellations.
- Full-trade and position updates over SSE with transactional outbox recovery.
- Append-only audit history, a separate history view and a Position Summary tab.
- Structured logging and CI checks. P&L remains deferred.

## Run locally

Use Node **24.14.0**, pnpm **12.11.2** and a running Docker engine. From the root:

```sh
pnpm install --frozen-lockfile
cp backend/.env.example backend/.env
cp database/.env.example database/.env
pnpm db:up
pnpm db:migrate:dev
pnpm db:seed
pnpm dev
```

Use `Copy-Item` instead of `cp` in PowerShell. Start the frontend in another terminal:

```sh
pnpm --filter @trade-blotter/frontend dev
```

Open **http://localhost:5173**. The API is **http://localhost:3000**;
`GET /api/health` returns `{"status":"ok"}`. Vite proxies `/api` during development;
port 5173 must be available. PostgreSQL runs in the background on localhost:5432.

A fresh seed creates 10 instruments, 4 accounts, 500 synthetic trades, 649 audit
entries and 10 summaries. Reruns preserve existing data and report inserted counts.
The named Docker volume retains database data across container restarts.

### Configuration

| Variable | Location / meaning |
| --- | --- |
| `DATABASE_URL` | `backend/.env` and `database/.env`; both must target the intended PostgreSQL database. |
| `APP_ORIGIN` | Backend; allowed browser origin, default `http://localhost:5173`. |
| `PORT` | Backend; default 3000. |
| `LOG_LEVEL` | Backend JSON logging; default `info`, `debug` adds delivery records. |
| `NODE_ENV` | `production` enables Secure cookies and requires an HTTPS `APP_ORIGIN`. |

## Demo accounts

All use the local demo password **`LocalDemo!2026`**. All trades and prices are fictional.

| Email | Role |
| --- | --- |
| `jsmith@example.com` | Trader |
| `adoe@example.com` | Trader |
| `mlee@example.com` | Trader |
| `reviewer@example.com` | Read-only |

Use separate browser profiles or normal/private windows for two accounts; ordinary
tabs share cookies. Create/amend/cancel in one and observe updates in the other.

## Checks and build

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @trade-blotter/frontend lint
pnpm --filter @trade-blotter/frontend build
```

Root checks build the database package before the backend. Root tests cover database
helpers, backend and frontend without requiring a running PostgreSQL instance.
`pnpm start` runs the built API; frontend static output is in `frontend/dist`.
GitHub Actions runs the checks on main pushes, pull requests and manual dispatch.

| Database command | Purpose |
| --- | --- |
| `pnpm db:logs` | Follow PostgreSQL logs. |
| `pnpm db:down` | Stop containers and retain their volume. |
| `pnpm db:validate` | Validate the Prisma schema. |
| `pnpm db:migrate:create --name change_name` | Generate a migration for review without applying it. |
| `pnpm db:migrate:dev` | Apply local development migrations. |
| `pnpm db:seed` | Seed synthetic data. |
| `pnpm db:studio` | Inspect the database. |

## Documentation

| Guide | Read for |
| --- | --- |
| [Technical Design](docs/technical-design.md) | Architecture, authentication, database, API contracts, trade flows, audit, positions and diagnostics. |
| [Real-time Updates](docs/realtime.md) | Outbox delivery, SSE connections, frontend merging and reconnect recovery. |
| [Decisions and Scaling](docs/decisions.md) | Rationale, alternatives, limits and production scaling needs. |

Code links name the relevant function/declaration; search that symbol in the linked
file. Line-number anchors are intentionally avoided because edits move them.

## Deployment

Currently only PostgreSQL is containerized. Backend container packaging, AWS hosting
and deployment automation are pending; CI currently verifies code rather than deploying it.

Deployment must provide HTTPS, an exact `APP_ORIGIN`, database connectivity and
same-origin `/api` routing for the static frontend. Vite's proxy is development-only.
The API runtime also needs its external workspace/npm dependencies and generated
Prisma client. Apply SQL migrations before starting the application; seed is an
explicit demo-data operation. Forward container stdout to the hosting log service.

SSE routing must avoid response buffering and support long-lived connections. Start
with one API instance; multi-instance fan-out needs the changes in
[Decisions and Scaling](docs/decisions.md#production-path). Deployment instructions
and p50/p95/p99 results will be added after those tasks are implemented and verified.
