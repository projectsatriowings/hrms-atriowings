# syntax=docker/dockerfile:1
# Attenza — multi-stage build for the API (NestJS) + web (Next.js) apps.
# Build with:  docker build -t attenza .
# Run with:    docker compose up --build   (see docker-compose.yml)
# The runtime image contains both apps; compose picks one per service via
# its command. Secrets are NEVER baked in: DATABASE_URL / JWT_ACCESS_SECRET
# / BANK_ENCRYPTION_KEY come from the environment at run time.
# NEXT_PUBLIC_API_URL is the ONE exception to "nothing baked in": Next.js
# inlines NEXT_PUBLIC_* variables into the browser bundle at build time, so
# it must be an ARG. It defaults to the same-origin proxy path /api/v1 (see
# Caddyfile): the browser then calls the API on the same origin it loaded
# the page from, so the SameSite=Lax refresh cookie is sent. Never point it
# at localhost:4000 in a deployed image — that bakes a loopback address into
# every visitor's browser. Override per deployment via compose args, e.g.
# NEXT_PUBLIC_API_URL=https://attenza.example.com/api/v1.

FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

FROM deps AS build
# Build-time only: inlined into the web bundle by Next.js (see header).
ARG NEXT_PUBLIC_API_URL=/api/v1
COPY . .
RUN pnpm --filter @hrms/shared build \
 && pnpm --filter @hrms/api exec prisma generate \
 && pnpm --filter @hrms/api build \
 && pnpm --filter @hrms/web build

FROM node:20-alpine AS runtime
RUN corepack enable && corepack prepare pnpm@10 --activate
ENV NODE_ENV=production
WORKDIR /app
# Non-root runtime: node:20-alpine ships a built-in `node` user (uid 1000).
# Every copied tree is --chown'ed to it so the app runs without root and
# without a read/write failure on start. /app itself stays root-owned but
# world-traversable (755); neither service writes to /app at runtime (the
# API writes nothing to disk, `next start` only reads .next), so no
# writable-path setup is needed. If a future feature writes uploads or
# logs to disk, add an explicit chown'ed directory for it here.
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --chown=node:node --from=build /app/packages ./packages
COPY --chown=node:node --from=build /app/apps/api/dist ./apps/api/dist
COPY --chown=node:node --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --chown=node:node --from=build /app/apps/api/package.json ./apps/api/
COPY --chown=node:node --from=build /app/apps/web/.next ./apps/web/.next
COPY --chown=node:node --from=build /app/apps/web/public ./apps/web/public
COPY --chown=node:node --from=build /app/apps/web/package.json ./apps/web/
COPY --chown=node:node --from=build /app/apps/web/next.config.js ./apps/web/
USER node
EXPOSE 4000 3000
# Default: API. Compose overrides the web service's command.
CMD ["node", "apps/api/dist/main.js"]
