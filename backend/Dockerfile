# syntax=docker/dockerfile:1
FROM node:24.14.0-bookworm-slim AS base
# Prisma tooling detects OpenSSL; CA certificates support verified database TLS.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS workspace
WORKDIR /app
RUN npm install --global pnpm@12.11.2

# All workspace manifests keep frozen-lockfile resolution consistent.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json ./backend/package.json
COPY database/package.json ./database/package.json
COPY frontend/package.json ./frontend/package.json

FROM workspace AS build
RUN pnpm install --frozen-lockfile --filter @trade-blotter/backend...
COPY backend ./backend
COPY database ./database
# Generates Prisma Client, compiles the database package, then bundles the API.
# No database connection or credentials are needed to build.
RUN pnpm build

FROM workspace AS production-dependencies
RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter @trade-blotter/backend...

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 LOG_LEVEL=info
WORKDIR /app

# Preserve pnpm's workspace links: the API imports @trade-blotter/database at runtime.
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/backend/node_modules ./backend/node_modules
COPY --from=production-dependencies /app/database/node_modules ./database/node_modules
COPY backend/package.json ./backend/package.json
COPY database/package.json ./database/package.json
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/database/dist ./database/dist

USER node
WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/index.js"]
