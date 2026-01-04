# Build stage
FROM node:22-alpine AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Production stage
FROM node:22-alpine AS runner

# Install pnpm for production
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package.json ./package.json

# Create directory for SQLite database
RUN mkdir -p /app/data

# Expose port 3000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["pnpm", "start"]
