# Build stage
FROM node:24-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

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

# Build the www application
RUN cd apps/www && pnpm build

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

# Production stage
FROM node:24-slim AS runner

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/apps/www/.output ./.output
COPY --from=builder /app/apps/www/package.json ./package.json

# Create directory for SQLite database
RUN mkdir -p /app/data

# Expose port 3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", ".output/server/index.mjs"]
