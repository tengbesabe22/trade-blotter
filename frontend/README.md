# Frontend

React + TypeScript + Vite, with Tailwind CSS and Oxlint.
The development API proxy and auth client are ready. The current page is still
the starter; login UI and the blotter grid are next.

## Commands

Run from the repository root after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @trade-blotter/frontend dev
pnpm --filter @trade-blotter/frontend test
pnpm --filter @trade-blotter/frontend lint
pnpm --filter @trade-blotter/frontend build
```

Vite uses `http://localhost:5173` and fails if the port is occupied. This keeps
the origin aligned with the backend's local `APP_ORIGIN`. Build output is in
`frontend/dist/`. Strict TypeScript checking covers source and API-client tests.

## File map

| File | Purpose |
| --- | --- |
| `index.html` | HTML entry point |
| `src/main.tsx` | Mounts React |
| `src/api/api-client.ts` | Fetch wrapper, cookies, and structured HTTP errors |
| `src/api/auth-api.ts` | Login, current-user, and logout calls |
| `src/api/auth-contract.ts` | Browser-side request/response shapes and inferred types |
| `src/App.tsx` | Root component and current starter page |
| `src/index.css` | Global styles and Tailwind entry |
| `src/App.css` | Starter component styles |
| `src/assets/` | Imported images and SVGs |
| `public/` | Static files copied to the build |
| `vite.config.ts` | React/Tailwind plugins and local API proxy |
| `.oxlintrc.json` | Lint rules |
| `tsconfig*.json` | TypeScript settings |
| `package.json` | Frontend dependencies and scripts |

## Request flow

Start the backend with `pnpm dev` in another terminal. Browser code calls relative
URLs such as `/api/auth/login`; Vite forwards `/api` to `http://localhost:3000`
without removing the prefix. The browser handles the HttpOnly session cookie.
The API client leaves the browser's Origin header intact.

`authApi.login()` and `authApi.me()` validate their JSON responses with Zod.
`authApi.logout()` accepts an empty 204 response. HTTP failures throw `ApiError`
with `status`, `code`, and `message`; network failures propagate to the caller.
The UI will consume these methods in the next slice.

The frontend keeps a small browser-safe auth contract; backend password/session
implementation details are not imported. Business validation remains on the API.
The dev proxy is not bundled into static output; production needs `/api` routing.

`pnpm test` at the root runs backend tests and the fetch-mocked frontend tests.
For backend setup, see the [project README](../README.md).
