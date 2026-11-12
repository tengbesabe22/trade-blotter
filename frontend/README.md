# Frontend

React + TypeScript + Vite, with Tailwind CSS and Oxlint.
The current page is the starter; login, the blotter grid, and API integration
are planned.

## Commands

Run from the repository root after `pnpm install --frozen-lockfile`:

```sh
pnpm --filter @trade-blotter/frontend dev
pnpm --filter @trade-blotter/frontend lint
pnpm --filter @trade-blotter/frontend build
```

Vite prints the local development URL, normally `http://localhost:5173`.
Build output is in `frontend/dist/`.

## File map

| File | Purpose |
| --- | --- |
| `index.html` | HTML entry point |
| `src/main.tsx` | Mounts React |
| `src/App.tsx` | Root component and current starter page |
| `src/index.css` | Global styles and Tailwind entry |
| `src/App.css` | Starter component styles |
| `src/assets/` | Imported images and SVGs |
| `public/` | Static files copied to the build |
| `vite.config.ts` | React and Tailwind plugins |
| `.oxlintrc.json` | Lint rules |
| `tsconfig*.json` | TypeScript settings |
| `package.json` | Frontend dependencies and scripts |

API proxying and browser authentication are not configured yet.
For backend setup, see the [project README](../README.md).
