# Frontend

React + TypeScript + Vite, with Tailwind CSS and Oxlint.
Login, logout, session restoration on refresh, the API client, and development
proxy are implemented. The blotter grid is next.

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
`frontend/dist/`. Strict TypeScript checking covers source and frontend tests.

## File map

| File | Purpose |
| --- | --- |
| `index.html` | HTML entry point |
| `src/main.tsx` | Mounts React |
| `src/api/api-client.ts` | Fetch wrapper, cookies, and structured HTTP errors |
| `src/api/auth-api.ts` | Login, current-user, and logout calls |
| `src/api/auth-contract.ts` | Browser-side request/response shapes and inferred types |
| `src/App.tsx` | Restores the session and chooses checking, login, account, or retry views |
| `src/auth/LoginForm.tsx` | Controlled email/password inputs, submission, pending state, and errors |
| `src/auth/AccountPanel.tsx` | Account display and confirmed logout |
| `src/index.css` | Global styles and Tailwind entry |
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
`LoginForm` calls `authApi.login()` and passes the returned user to `App` through
`onAuthenticated`. `App` renders `AccountPanel`, which calls `authApi.logout()`
and notifies the parent through `onSignedOut` after success. Each component owns
its pending/error state. Passwords are kept only in the form's component state.

The current user is held in React memory. On every fresh app mount, including a
refresh, `App` checks `/me` using the existing HttpOnly cookie:

| Result | UI |
| --- | --- |
| Pending | Checking state; no login-form flash |
| 200 | Restore the returned account and role |
| 401 | Show the login form |
| Network, server, or invalid-response error | Show a retry action |

`authApi.me()` accepts an optional AbortSignal. Effect cleanup aborts obsolete
checks and ignores their results, so a delayed response cannot restore an account
after logout. Only startup and explicit retries perform this check; no background
polling is added.

The frontend keeps a small browser-safe auth contract; backend password/session
implementation details are not imported. Business validation remains on the API.
The dev proxy is not bundled into static output; production needs `/api` routing.

`pnpm test` at the root runs backend and frontend tests. API-client tests mock
fetch. Component tests use Testing Library and a jsdom environment with the same
Node/tsx runner; they test interactions, pending states, and failed requests.
For backend setup, see the [project README](../README.md).
