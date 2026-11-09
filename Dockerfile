# syntax=docker/dockerfile:1

# Fekra API image (constitution "Delivery Pipeline & Deployment", plan task T113).
#
#   docker build -t fekra-api .                      # runtime: the API (default target)
#   docker build --target migrate -t fekra-migrate . # one-off `prisma migrate deploy`
#
# No configuration or secret is baked in: everything comes from the environment at run time.

ARG NODE_VERSION=22

# ---- base: OS packages shared by every stage -------------------------------------------------
FROM node:${NODE_VERSION}-bookworm-slim AS base
# Prisma reads the OpenSSL version to pick its schema-engine binary (used by migrate deploy).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- deps: the full dependency tree (Nest CLI, TypeScript and the Prisma CLI are dev deps) ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci

# ---- build: generate the Prisma client, then compile to dist/ ---------------------------------
FROM deps AS build
COPY . .
# prisma7.config.ts calls env('DATABASE_URL'), which throws when the variable is unset.
# `prisma generate` never connects, so a placeholder scoped to this one command is enough.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
  && npm run build

# ---- migrate: one-off container that applies the committed migrations -------------------------
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma7.config.ts ./
# npx would otherwise check the registry for npm updates on every run
ENV NPM_CONFIG_UPDATE_NOTIFIER=false
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

# ---- prod-deps: runtime dependencies only -----------------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev

# ---- runtime: what runs in production (last stage = default target) ---------------------------
FROM base AS runtime
ENV NODE_ENV=production
# Files stay root-owned: the app only needs to read them.
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY prisma ./prisma
USER node
EXPOSE 3000
# GET /health answers 200 only when PostgreSQL and Redis are reachable.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/main"]
