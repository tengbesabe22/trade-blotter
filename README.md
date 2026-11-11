# Trade Blotter

Small trading platform application that allows users to view and manage a trade blotter containing equity trades

```text
backend/    Hono + TypeScript Node.js starter
frontend/   Placeholder
database/  Placeholder
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
