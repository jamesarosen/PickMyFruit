# Build stage
FROM node:22-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

WORKDIR /app

# Copy workspace configuration files
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./

# Copy app package.json files to maintain workspace structure
COPY apps/www/package.json ./apps/www/package.json

# Copy packages if any (for future workspace packages)
# COPY packages/*/package.json ./packages/

# Install dependencies using pnpm workspace
RUN pnpm install --frozen-lockfile --filter @pickmyfruit/www...

# Copy the entire workspace (excluding dockerignored files)
COPY . .

# Build the www application
RUN cd apps/www && pnpm build

# Production stage
FROM node:22-slim AS runner

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/apps/www/.output ./.output
COPY --from=builder /app/apps/www/package.json ./package.json

# Create directory for SQLite database
RUN mkdir -p /app/data

# Expose port 3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", ".output/server/index.mjs"]
