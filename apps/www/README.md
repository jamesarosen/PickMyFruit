# Pick My Fruit - Web Application

This is the main web application for Pick My Fruit, built with Solid JS and TanStack Router.

## 🚀 Project Structure

```text
/
├── public/          # Static assets (images, fonts, etc.)
├── src/
│   ├── components/  # Reusable UI components
│   ├── routes/      # Page components and routing
│   ├── styles/      # Global styles and CSS
│   └── main.tsx     # Application entry point
├── index.html       # HTML entry point
├── vite.config.ts   # Vite configuration
└── package.json
```

- Routes are defined in `src/routes/` using TanStack Router's file-based routing
- Components are Solid JS components in `src/components/`
- Static assets like images can be placed in the `public/` directory

## 🧞 Commands

All commands are run from the root of the project, from a terminal:

| Command             | Action                                       |
| :------------------ | :------------------------------------------- |
| `pnpm install`      | Installs dependencies                        |
| `pnpm dev`          | Starts local dev server at `localhost:3000`  |
| `pnpm build`        | Build your production site to `./.output/`   |
| `pnpm start`        | Run production build locally                 |
| `pnpm preview`      | Preview your build locally, before deploying |
| `pnpm lint`         | Run oxlint to check code quality             |
| `pnpm typecheck`    | Run TypeScript compiler to check types       |
| `pnpm format`       | Format code with Prettier                    |
| `pnpm deploy`       | Deploy to Fly.io                             |
| `pnpm deploy:setup` | Initial Fly.io app setup                     |
| `pnpm logs`         | View production logs                         |

## 🛠️ Tech Stack

- [Solid JS](https://www.solidjs.com/) - Reactive UI library with SSR
- [TanStack Router](https://tanstack.com/router) - Type-safe routing
- [TanStack Start](https://tanstack.com/start) - SSR framework
- [Nitro](https://nitro.unjs.io/) - Server engine
- [Vite](https://vitejs.dev/) - Build tool and dev server
- [TypeScript](https://www.typescriptlang.org/) - Type safety
- [Drizzle ORM](https://orm.drizzle.team/) - TypeScript ORM
- [SQLite](https://www.sqlite.org/) - Database

## 🐳 Docker Development

Test the production build locally using Docker Compose:

```bash
# Change to the workspace directory
$ cd path/to/PickMyFruit

# Create a .env file in the workspace
$ cp -n .env.example .env

# Build and start the container
$ pnpm docker:up

# View logs
$ pnpm docker:logs

# Stop the container
$ pnpm docker:down
```

The application will be available at `http://localhost:3000`. The SQLite database will be persisted in `./data/` directory.

This matches the production environment on Fly.io, making it useful for:

- Testing the production build locally before deploying
- Debugging deployment issues
- Verifying volume mounting and database persistence

## 🚢 Deployment

This application is configured for deployment to [Fly.io](https://fly.io) with SQLite persistence.

### Prerequisites

1. Install the [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/)
2. Create a Fly.io account: `fly auth signup` or `fly auth login`

### Initial Setup

**First time deployment:**

```bash
# Run from workspace root (/Users/jamesrosen/Code/PickMyFruit)

# 1. Set your app name in fly.toml (replace 'pickmyfruit')
# 2. Create the app and volume (but don't deploy yet)
pnpm deploy:setup

# 3. Create the persistent volume for SQLite
fly volumes create data --size 1 --region sjc

# 4. Deploy the application
pnpm deploy
```

**Note:** All deployment commands should be run from the **workspace root**, not from `apps/www/`, since the `fly.toml` and monorepo configuration are at the root level.

### Subsequent Deployments

```bash
# Deploy latest changes
pnpm deploy

# View logs
pnpm logs

# SSH into the running instance
pnpm ssh
```

### Verify Deployment

After deployment, verify the application is running:

```bash
# Check health endpoint
curl https://your-app-name.fly.dev/api/health

# Open in browser
fly open
```

### Database Management

To run database migrations or seed data in production:

```bash
# SSH into the production machine
pnpm ssh

# Inside the machine:
cd /app
DATABASE_URL=file:/app/data/production.db pnpm db:push
DATABASE_URL=file:/app/data/production.db pnpm db:seed
```

### Configuration

Key configuration files:

- `../../fly.toml` - Fly.io deployment configuration (workspace root)
- `Dockerfile` - Multi-stage build for Node.js + SQLite (monorepo-aware)
- `../../.dockerignore` - Files excluded from Docker build (workspace root)
- `.env` - Local environment variables (not deployed)

In released environments, client-side environment variables are (1) set in
`fly.toml` `[build.args]`, (2) passed through `Dockerfile` `ARG`s, and (3)
parsed in `env.client.ts`.

**Note:** The `.dockerignore` file must be at the workspace root because Fly.io's `build.ignorefile` setting resolves relative to the working directory (where you run `fly deploy`).

Production environment variables are set in `fly.toml` under `[env]`.

### Troubleshooting

**Volume not mounting:**

```bash
fly volumes list
fly volumes create data --size 1 --region sjc
```

**Health check failing:**

```bash
fly logs
# Check /api/health endpoint is responding
```

**Database connection issues:**

```bash
# Verify DATABASE_URL is set correctly
fly ssh console -C "env | grep DATABASE"
# Should show: DATABASE_URL=file:/app/data/production.db
```
