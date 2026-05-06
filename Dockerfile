# syntax=docker/dockerfile:1
# One image — two entrypoints: web (apps/www) and photos (apps/photos).
# fly.toml [processes] selects the entrypoint per process group.

# Build stage
FROM node:24-slim AS builder

# Install CA certificates (required by sentry-cli for TLS) and pnpm.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

# Install sentry-cli for the sourcemap upload step below.
# Pin to a specific version to prevent unplanned breakage on future builds.
# Bump this intentionally when upgrading; changelog: https://github.com/getsentry/sentry-cli/releases
RUN npm install -g @sentry/cli@3.3.2

WORKDIR /app

# Copy workspace configuration files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy app package.json files to maintain workspace structure
COPY apps/www/package.json ./apps/www/package.json
COPY apps/photos/package.json ./apps/photos/package.json

# Install dependencies for both apps.
# --cpu and --os flags (pnpm 10.14+) install optional binaries for all target
# architectures so the image runs on both x64 and arm64 hosts. This matters
# for sharp (libvips native binary) and @libsql.
RUN pnpm install --frozen-lockfile \
    --filter @pickmyfruit/www... \
    --filter @pmf/photos... \
    --cpu=x64 --cpu=arm64 --os=linux

# Copy the entire workspace (excluding dockerignored files)
COPY . .

# VITE_* variables are replaced at build time; they cannot be injected at
# runtime via Fly secrets. See fly.toml [build.args] and env.client.ts.
ARG VITE_SENTRY_DSN
ARG VITE_SENTRY_ENABLED
ARG VITE_SENTRY_ERROR_SAMPLE_RATE
ARG VITE_SENTRY_TRACES_SAMPLE_RATE
ARG VITE_SENTRY_ENVIRONMENT
# Non-sensitive Sentry identifiers needed by sentry-cli at upload time.
ARG SENTRY_ORG
ARG SENTRY_PROJECT
# SENTRY_RELEASE is the canonical release name (git SHA) used by sentry-cli.
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

# Build the photos application.
RUN cd apps/photos && pnpm build

# Create a standalone deployment for photos with production dependencies only.
# pnpm deploy produces a flat (hoisted) node_modules without the virtual store,
# which copies cleanly into the runner image.
# --cpu/--os flags mirror the main install so arm64 Sharp binaries are included.
# NOTE: pnpm deploy copies node_modules (prod-only) + package files; we only
# take node_modules from /photos-standalone and copy dist/ directly from the
# builder to keep the runner stage explicit and avoid a redundant copy.
RUN pnpm --filter @pmf/photos deploy --prod /photos-standalone \
    --cpu=x64 --cpu=arm64 --os=linux

# Production stage
FROM node:24-slim AS runner

WORKDIR /app

# --- web (apps/www) ---
# Copy the self-contained Nitro bundle. All www dependencies are bundled in.
COPY --from=builder /app/apps/www/.output ./.output
COPY --from=builder /app/apps/www/package.json ./package.json

# Migration SQL files are read from disk at runtime by drizzle-orm/libsql/migrator.
COPY --from=builder /app/apps/www/drizzle ./drizzle
RUN test -f /app/drizzle/meta/_journal.json || \
  (echo "ERROR: drizzle migrations missing from image" && exit 1)

# --- photos (apps/photos) ---
# dist/ is excluded from pnpm deploy by .gitignore, so copy it directly.
COPY --from=builder /app/apps/photos/dist ./apps/photos/dist
# package.json is needed for Node to recognise the ESM "type": "module" declaration.
COPY --from=builder /app/apps/photos/package.json ./apps/photos/package.json
# Production node_modules from pnpm deploy (flat, no symlinks to virtual store).
COPY --from=builder /photos-standalone/node_modules ./apps/photos/node_modules

# Create directory for SQLite database (web only; photos has no persistence).
RUN mkdir -p /app/data

# Expose both service ports.
EXPOSE 3000 8080

# Health check for the web process (default CMD).
# fly.toml defines per-process health checks; this is a fallback for local runs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Default entrypoint is web. fly.toml [processes] overrides this per group:
#   web    = "node .output/server/index.mjs"
#   photos = "node apps/photos/dist/index.js"
CMD ["node", ".output/server/index.mjs"]
