# syntax=docker/dockerfile:1
# Single container: Fastify API + built web app, SQLite and blobs on a volume at /data.

ARG NODE_IMAGE=node:22-bookworm-slim

# ---- base: toolchain for better-sqlite3 (falls back to a source build when no prebuilt binary matches) ------------
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm CI=true
ENV PATH=$PNPM_HOME:$PATH
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
# pnpm version comes from "packageManager" in package.json
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && corepack prepare --activate

# ---- build: all packages, web bundle --------------------------------------------------------------------------------
FROM base AS build
COPY packages/core/package.json packages/core/
COPY packages/scene/package.json packages/scene/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
COPY . .
RUN pnpm -r typecheck && pnpm --filter web build

# ---- prod-deps: production dependencies only (native module compiled here, copied as-is) ----------------------------
FROM base AS prod-deps
COPY packages/core/package.json packages/core/
COPY packages/scene/package.json packages/scene/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY e2e/package.json e2e/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --prod --filter "server..."
# Fail the build now if the native module did not compile.
RUN cd apps/server && node -e "const D=require('better-sqlite3');new D(':memory:').close();console.log('better-sqlite3 ok')"

# ---- runtime ---------------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    STATIC_DIR=/app/web
WORKDIR /app/apps/server
# The workspace packages ship TypeScript sources and the server runs through tsx (a production dependency).
COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=prod-deps /app/packages/core/node_modules /app/packages/core/node_modules
COPY --from=prod-deps /app/apps/server/node_modules ./node_modules
COPY packages/core/package.json /app/packages/core/package.json
COPY packages/core/src /app/packages/core/src
COPY packages/core/tsconfig.json /app/packages/core/tsconfig.json
COPY tsconfig.base.json /app/tsconfig.base.json
COPY apps/server/package.json apps/server/tsconfig.json ./
COPY apps/server/src ./src
COPY --from=build /app/apps/web/dist /app/web
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# exec form so SIGTERM reaches node (graceful shutdown)
CMD ["node_modules/.bin/tsx", "src/main.ts"]
