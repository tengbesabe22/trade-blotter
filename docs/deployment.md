# Deployment

## Services

| Component | Service | Address / responsibility |
| --- | --- | --- |
| Frontend | Vercel | [app.teng.website](https://app.teng.website); static React application. |
| API | AWS Lightsail | One Dockerized Hono process. |
| Reverse proxy | Caddy on Lightsail | `api.teng.website`; HTTPS, JSON gzip and uncompressed SSE. |
| Database | Neon | Managed PostgreSQL; migrations and seed run separately. |

The browser calls the API directly over HTTPS. The two subdomains share a site;
credentialed CORS permits only the configured frontend origin. Keep one API
instance until [shared event fan-out](decisions.md#production-path) is implemented.

## Configuration

| Setting | Where | Value |
| --- | --- | --- |
| `VITE_API_ORIGIN` | Vercel Production environment | `https://api.teng.website` |
| `APP_ORIGIN` | Lightsail `deploy/.env` | `https://app.teng.website` |
| `DATABASE_URL` | Lightsail `deploy/.env` | Neon connection string with its TLS parameters. |

## Deploy the backend

Requires Docker Engine and Compose on the VM, a static IP with the `api` DNS record,
open TCP ports 80/443, and a migrated Neon database. Port 3000 stays private to
[Production Compose](../compose.production.yml).

On Lightsail:

```sh
git clone https://github.com/tengbesabe22/trade-blotter.git
cd trade-blotter
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
nano deploy/.env
```

Set the values above; keep the Neon URL inside single quotes. Then:

```sh
sudo docker compose --env-file deploy/.env -f compose.production.yml config --quiet
sudo docker compose --env-file deploy/.env -f compose.production.yml up --build -d --wait
sudo docker compose --env-file deploy/.env -f compose.production.yml ps
curl -fsS https://api.teng.website/api/health
```

Expected health: `{"status":"ok"}`. Startup does not migrate or seed the database.

## Deploy the frontend

Connect the repository to Vercel and assign `app.teng.website` as its domain.
With the repository root selected, use:

| Setting | Value |
| --- | --- |
| Build command | `pnpm --filter @trade-blotter/frontend build` |
| Output directory | `frontend/dist` |
| Production variable | `VITE_API_ORIGIN=https://api.teng.website` |

Build a new Production deployment after changing the variable; Vite embeds it at
build time. Use `https://app.teng.website` for sign-in so the HTTPS subdomains work
with the API's Secure, HttpOnly, SameSite=Lax session cookie.

## Caddy configuration

The mounted [Caddyfile](../deploy/Caddyfile) is:

```caddy
api.teng.website {
	# Compress JSON responses; keep the SSE stream uncompressed.
	encode gzip {
		match {
			header Content-Type application/json*
		}
	}

	# Caddy flushes text/event-stream responses immediately for SSE.
	reverse_proxy backend:3000
}
```

Certificate state persists in named volumes. JSON responses can use gzip; SSE
stays uncompressed and streams immediately.

## Update services

Run inside the existing Lightsail checkout.

**Backend:**

```sh
git pull --ff-only
sudo docker compose --env-file deploy/.env -f compose.production.yml up --build -d --wait backend
```

**Caddy configuration:** recreate Caddy to load the updated bind-mounted file.
Certificate volumes are retained; existing SSE connections briefly reconnect.

```sh
git pull --ff-only
sudo docker compose --env-file deploy/.env -f compose.production.yml up -d --no-deps --force-recreate caddy
```

**Logs:**

```sh
sudo docker compose --env-file deploy/.env -f compose.production.yml logs --tail=50 backend caddy
```

## Verify

- Health returns 200; sign-in and refresh restore the session.
- In separate browser sessions, create/amend/cancel a trade and confirm live updates.
- Larger trade-list responses include `Content-Encoding: gzip`; SSE does not.
- CORS preflights include `Access-Control-Max-Age: 600`; test repeat browser requests
  with DevTools **Disable cache unchecked**.
- Sessions expire after 15 minutes without foreground API activity, with an
  eight-hour maximum. SSE and background reads do not renew idle time.
