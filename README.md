# Pick My Fruit

[Pick My Fruit](http://pickmyfruit.com) is a website that helps neighbors share fruit and other produce that would otherwise go to waste.

## Goals

1. Rescue the most food and make productive use of it
2. Feed the most people

## Values

- Stewardship Over Ownership
- Abundance Through Connection
- Practical Urgency

## License & Commercial Aspects

Pick My Fruit is made by the community, for the community. Our source-code is free and open-source (generally Apache-2.0).

We may ask for donations or pursue other revenue streams, but only to further the mission. Profit is explicitly _not_ a motive.

## Technology

- [Solid JS](https://www.solidjs.com/) & [TanStack Router](https://tanstack.com/router) for the frontend
- [Vite](https://vitejs.dev/) for build tooling
- [Better Auth](https://www.better-auth.com/) for authentication
- [Fly.io](https://fly.io/) for hosting
- [Docker](https://www.docker.com/) for containerization
- [SQLite](https://sqlite.org/index.html), running on [Turso](https://turso.tech/) in deployed environments
- [GitHub Actions](https://docs.github.com/en/actions) for CI/CD

## Development

Prerequisites:

- [Node.js](https://nodejs.org) 24 (e.g. `nvm install 24`; pnpm scripts then use the exact version pinned in `.npmrc`)
- [pnpm](https://pnpm.io), version pinned in the root `package.json` `packageManager` field — `corepack enable` activates it

First-time setup and running the app:

```sh
pnpm install
cd apps/www
pnpm db:migrate   # create and migrate the local SQLite database
pnpm dev          # serves http://localhost:5173
```

Signing in during development uses magic links: with the default `EMAIL_PROVIDER=console`, the link is logged to the dev-server console — look for the log line containing `token:`.

Checks, run from the repo root:

```sh
pnpm lint
pnpm typecheck
pnpm test:run               # unit tests
bash bin/quality-gate.sh    # everything CI runs (format, lint, typecheck, tests)
```

E2E tests run with `pnpm test:e2e` from `apps/www`. See [CLAUDE.md](./CLAUDE.md) for the full list of conventions and commands.

## Credits

- [Jake Trimble](http://jaketrimble.com) for the domain

## Further Reading

- The [Project Vision](./docs/project-vision.md) has deeper context on goals, values, and operating principles.
