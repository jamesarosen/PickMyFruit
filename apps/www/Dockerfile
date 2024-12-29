# syntax = docker/dockerfile:1

# Build and run the www application
#
# @pwd ../../
#
# @see PNPM: Build multiple Docker images in a monorepo
# https://pnpm.io/docker#example-2-build-multiple-docker-images-in-a-monorepo

# === Stage base ===
# Operating system, Node, pnpm
ARG NODE_VERSION=22.12.0
FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# === Stage built_workspace ===
# Installs dependencies, builds the applications, uninstalls
# development dependencies, deploys the app to `/app`.
#
# @todo https://dev.to/jonlauridsen/exploring-the-monorepo-5-perfect-docker-52aj
# has some tips on how to make this more efficient
FROM base AS built_workspace
ENV CI=true
WORKDIR /workspace
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run -r build
RUN pnpm --filter=@pickmyfruit/www --prod deploy /app

# === Stage runtime ===
# Copy the built application from `built_workspace` and run the www application
FROM built_workspace AS runtime
LABEL fly_launch_runtime="Astro"
LABEL "website.name"="Pick My Fruit"
ENV NODE_ENV="production"
WORKDIR /app
COPY --from=built_workspace /app .
ENV PORT=4321
ENV HOST=0.0.0.0
EXPOSE 4321
CMD [ "node", "./dist/server/entry.mjs" ]
