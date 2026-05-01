# syntax=docker/dockerfile:1
# Build stage
FROM node:24-slim AS builder

# Install CA certificates (required by sentry-cli to make TLS connections)
# and pnpm. node:24-slim omits the system CA bundle by default.
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

# Copy packages if any (for future workspace packages)
# COPY packages/*/package.json ./packages/

# Install dependencies using pnpm workspace.
# --cpu and --os flags (pnpm 10.14+) explicitly install optional binaries for
# all target architectures so the image runs on both x64 and arm64 hosts.
RUN pnpm install --frozen-lockfile --filter @pickmyfruit/www... \
    --cpu=x64 --cpu=arm64 --os=linux

# Copy the entire workspace (excluding dockerignored files)
COPY . .

# VITE_* variables are replaced at build time; they cannot be injected at
# runtime via Fly secrets.
# See fly.toml [build.args]
# See env.client.ts
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

# Production stage
FROM node:24-slim AS runner

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/apps/www/.output ./.output
COPY --from=builder /app/apps/www/package.json ./package.json

# Migration SQL files are read from disk at runtime by drizzle-orm/libsql/migrator.
# They must be at ./drizzle relative to the working directory (/app/drizzle).
COPY --from=builder /app/apps/www/drizzle ./drizzle
RUN test -f /app/drizzle/meta/_journal.json || \
  (echo "ERROR: drizzle migrations missing from image" && exit 1)

# Create directory for SQLite database
RUN mkdir -p /app/data

# Expose port 3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", ".output/server/index.mjs"]
