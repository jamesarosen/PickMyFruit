# syntax=docker/dockerfile:1
# Build stage
FROM node:24-slim AS builder

# Install CA certificates (required by sentry-cli to make TLS connections)
# and pnpm. node:24-slim omits the system CA bundle by default.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.2.2 --activate

# Install sentry-cli for the sourcemap upload step below.
# Pin to a specific version to prevent unplanned breakage on future builds.
# Bump this intentionally when upgrading; changelog: https://github.com/getsentry/sentry-cli/releases
RUN npm install -g @sentry/cli@3.3.2

WORKDIR /app

# Copy workspace configuration files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy app package.json files to maintain workspace structure
COPY apps/www/package.json ./apps/www/package.json
COPY apps/resend-sync/package.json ./apps/resend-sync/package.json

# Needed by the root postinstall script. Copied before `pnpm install` so the
# script exists when postinstall fires; it self-skips when no `.git` is present.
COPY bin/install-git-hooks.sh ./bin/install-git-hooks.sh

# Copy packages if any (for future workspace packages)
# COPY packages/*/package.json ./packages/

# Install dependencies using pnpm workspace.
# --cpu and --os flags (pnpm 10.14+) explicitly install optional binaries for
# all target architectures so the image runs on both x64 and arm64 hosts.
RUN pnpm install --frozen-lockfile \
    --filter @pickmyfruit/www... \
    --filter @pickmyfruit/resend-sync... \
    --cpu=x64 --cpu=arm64 --os=linux

# Copy the entire workspace (excluding dockerignored files)
COPY . .

# VITE_* variables are replaced at build time; they cannot be injected at
# runtime via Fly secrets.
# See fly.toml [build.args]
# See env.ts
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENABLED
ARG VITE_SENTRY_ERROR_SAMPLE_RATE
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ARG VITE_SENTRY_ENVIRONMENT
# Non-sensitive Sentry identifiers needed by sentry-cli at upload time.
ARG SENTRY_ORG
ARG SENTRY_PROJECT
# SENTRY_RELEASE is the canonical release name (git SHA) used by sentry-cli.
# VITE_SENTRY_RELEASE defaults to it so both consumers always reference the same
# release — only pass SENTRY_RELEASE at build time; VITE_SENTRY_RELEASE is derived.
ARG SENTRY_RELEASE
ARG VITE_SENTRY_RELEASE=${SENTRY_RELEASE}

# Build the www application.
# Nitro's Rollup bundling phase (~3400 modules) can exceed Node's default
# ~2 GB heap. Set a higher limit to avoid OOM during Docker builds.
RUN cd apps/www && NODE_OPTIONS="--max-old-space-size=4096" pnpm build

# Upload sourcemaps to Sentry and delete them so they are absent from the
# final image. Runs after the full build so both client (.output/public/)
# and server (.output/server/) maps exist. If SENTRY_AUTH_TOKEN is absent
# (e.g. CI smoke tests), the step is a no-op.
# SENTRY_ORG, SENTRY_PROJECT, and SENTRY_RELEASE are available from the
# ARG declarations above; sentry-cli reads them from the environment.
RUN --mount=type=secret,id=sentry_auth_token \
    export SENTRY_AUTH_TOKEN=$(cat /run/secrets/sentry_auth_token 2>/dev/null || true) && \
    if [ -n "$SENTRY_AUTH_TOKEN" ]; then \
        sentry-cli sourcemaps upload \
            --release "$SENTRY_RELEASE" \
            apps/www/.output/public \
            apps/www/.output/server; \
    else \
        echo "INFO: SENTRY_AUTH_TOKEN absent — skipping sourcemap upload"; \
    fi; \
    find apps/www/.output -name '*.map' -delete

# traceDeps traces only the builder's native @libsql binary. Copy all Linux
# variants directly from pnpm's virtual store so the image runs on both x64
# and arm64 hosts. Uses -rL to dereference pnpm's symlinks into real files.
RUN set -e && \
  mkdir -p apps/www/.output/server/node_modules/@libsql && \
  for pkg_dir in node_modules/.pnpm/@libsql+linux-*; do \
    [ -d "$pkg_dir" ] || continue; \
    name=$(basename "$pkg_dir"); name=${name#@libsql+}; name=${name%@*}; \
    src="$pkg_dir/node_modules/@libsql/$name"; \
    [ -d "$src" ] || continue; \
    dest="apps/www/.output/server/node_modules/@libsql/$name"; \
    [ -d "$dest" ] || cp -rL "$src" "apps/www/.output/server/node_modules/@libsql/"; \
  done

RUN find apps/www/.output/server/node_modules/@libsql -name '*.node' | grep -q . || \
  (echo "ERROR: no @libsql .node binaries found in .output" && exit 1)

# Copy all Linux sharp platform packages from pnpm's virtual store so the image
# runs on both x64 and arm64 hosts. Mirrors the @libsql pattern above.
RUN set -e && \
  mkdir -p apps/www/.output/server/node_modules/@img && \
  for pkg_dir in node_modules/.pnpm/@img+sharp-linux-*; do \
    [ -d "$pkg_dir" ] || continue; \
    name=$(basename "$pkg_dir"); name=${name#@img+}; name=${name%@*}; \
    src="$pkg_dir/node_modules/@img/$name"; \
    [ -d "$src" ] || continue; \
    dest="apps/www/.output/server/node_modules/@img/$name"; \
    [ -d "$dest" ] || cp -rL "$src" "apps/www/.output/server/node_modules/@img/"; \
  done

RUN find apps/www/.output/server/node_modules/@img -name '*.node' | grep -q . || \
  (echo "ERROR: no @img/sharp .node binaries found in .output" && exit 1)

# Build the resend-sync worker with plain tsc — no Vite, no esbuild, no
# import.meta.env shimming. The worker is a Node binary and reads SENTRY_DSN
# (not VITE_SENTRY_DSN) at runtime.
RUN cd apps/resend-sync && pnpm build

# Materialize the worker as a self-contained deployable: pnpm's normal
# install layout uses symlinks back into the workspace-root virtual store
# (apps/resend-sync/node_modules/undici → ../../../node_modules/.pnpm/...),
# which would dangle in the runner image. `pnpm pm deploy` dereferences those
# into a flat node_modules under /tmp/resend-sync-deploy, including dist/
# from the build above. Use `pm deploy` (not bare `deploy`) because pnpm 11
# routes `pnpm deploy` to the root package's Fly deploy script. --legacy
# because the workspace does not opt into inject-workspace-packages.
RUN pnpm pm deploy --filter @pickmyfruit/resend-sync \
    --prod --legacy /tmp/resend-sync-deploy

# Production stage
FROM node:24-slim AS runner

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/apps/www/.output ./.output
COPY --from=builder /app/apps/www/package.json ./package.json

# resend-sync worker: self-contained deploy layout produced above. Brings
# dist/, package.json, and a flat node_modules (no dangling symlinks into
# the workspace virtual store, which the runner image does not carry).
COPY --from=builder /tmp/resend-sync-deploy ./apps/resend-sync
# Worker entrypoint path is pinned alongside the COPY above so it cannot drift.
# The runner image does not carry pnpm's virtual store, so spawn-resend-sync
# cannot fall back to `require.resolve('@pickmyfruit/resend-sync')` and reads
# this env instead. See PICKMYFRUIT-1N.
ENV RESEND_SYNC_WORKER_PATH=/app/apps/resend-sync/dist/main.js

# Build-time smoke test: with the kill switch off, apps/resend-sync/src/main.ts
# short-circuits at the gate check before opening the poll loop or any HTTP
# connection — but all imports (undici, pino, pino-pretty, @sentry/node, zod)
# run first, and the logger initializes its transport. So any module-resolution
# failure (a dangling symlink, a missing dep, a moved RESEND_SYNC_WORKER_PATH
# target) surfaces here at `docker build` time instead of at first prod deploy.
#
# NODE_ENV=development is intentional: it exercises the pino-pretty transport
# branch in logger.ts, which is the path docker-compose.yml and fly.preview.toml
# take at runtime. Without it, this smoke would not have caught pino-pretty
# being absent from the deploy. The INTERNAL_API_*, RESEND_API_KEY, and cursor
# path are throwaway placeholders chosen only to satisfy parseWorkerEnv's zod
# schema; the worker exits 0 before reading any of them.
RUN NODE_ENV=development \
    RESEND_SYNC_WORKER_ENABLED=false \
    INTERNAL_API_URL=http://smoke-test.invalid \
    INTERNAL_API_SECRET=build-time-smoke-test-placeholder-1234 \
    RESEND_SYNC_CURSOR_PATH=/tmp/smoke.json \
    RESEND_API_KEY=smoke \
    timeout 5 node "$RESEND_SYNC_WORKER_PATH" \
    || (echo "ERROR: resend-sync worker failed to load at build time" >&2 && exit 1)

# Migration SQL files are read from disk at runtime by drizzle-orm/libsql/migrator.
# They must be at ./drizzle relative to the working directory (/app/drizzle).
COPY --from=builder /app/apps/www/drizzle ./drizzle
RUN test -f /app/drizzle/meta/_journal.json || \
  (echo "ERROR: drizzle migrations missing from image" && exit 1)

# Create directory for SQLite database (shared with the worker via the Fly
# volume) and the resend-sync cursor directory.
RUN mkdir -p /app/data /app/data/resend-sync

# Expose port 3000
EXPOSE 3000

# Health check (applies to the web process only; the resend_sync process group
# does not bind a TCP port, so Fly's process-level liveness suffices).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Default command is the web server. fly.toml's [processes] block overrides
# this for the resend_sync process group.
CMD ["node", ".output/server/index.mjs"]
