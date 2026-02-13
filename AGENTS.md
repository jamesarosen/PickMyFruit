# Project: Pick My Fruit

## Project Description

A site for gardeners to share surplus produce with their community.

## Documentation

- Plans, architecture designs, and other larger-scale documentation go in `docs/`
- Use Mermaid for diagrams when possible
- Write JSDoc comments for exported values. Use a single short sentence unless the value being documented is particularly complex.
- Avoid inline comments that simply reiterate what the code does.

## Tech Stack

- Frontend: Solid JS, TanStack Router, TypeScript
- Build Tool: Vite
- Database: SQLite, Drizzle ORM
- Testing: Vitest
- Authentication: Better Auth
- Deployed environment: Fly.io, via Docker

## Code Conventions

- Prettier for formatting
- oxlint for linting
- 1-tab indentation
- camelCase for variables and functions
- PascalCase for components and classes
- Use semantic names for variables and functions to document what they do. Use comments to document why, especially for non-intuitive or unusual code.
- Use idiomatic Solid JS, TanStack Router, TypeScript, SQLite.
- Use context7
- When handling exceptions, import Sentry from `@/lib/sentry` and use `Sentry.captureException`. Do not separately log errors.

### Solid JS

- Use definitive assignment for refs, e.g. `let divRef!: HTMLDivElement... <div ref={divRef}/>`
- Use `for="..."`, not `htmlFor="..."`

### CSS

- Do not use Tailwind. Use CSS layers and variables. Keep CSS near the relevant components
- For colors, use semantic CSS variables (e.g. `--color-accent`) where possible and named color variables (e.g. `--color-sunset-coral`) where necessary. Avoid inline color definitions (e.g. `#fedbca`).
- Use CSS relative color syntax to create modifications, e.g. `oklch(from var(--color-accent) 0.65 c h)` to darken the accent color.

### Testing

- Use E2E tests to cover the most important flows
- Write a unit test for each non-trivial module
- Identify the 1-2 core intents of each module and test them
- Identify key risks of each module, especially around state or algorithmic complexity and test them
- Use test.each to build broad coverage of low-level primitives like formatters and parsers
- Use faker to generate test data for anything that a user might supply

## Project Structure

We use a monorepo structure

- /apps/www - a Solid JS + TanStack Router application
  - /src
    - /assets - images and other assets transformed by Vite
    - /components - Reusable Solid JS components and their related CSS
    - /routes - Page components (TanStack Router file-based routing) and their related CSS
    - /data - SQL schema, SQL queries, and TypeScript wrappers
    - /lib - Utility functions
    - /styles - Global styles and CSS
  - /public - Static assets, not transformed by Vite
  - /tests - Test files
- /packages/ - libraries extracted for reuse across applications

## Goals

- 30 days (2025-11-04): MVP with 10 beta users in one city. Manual matching OK. 3 successful fruit transfers.
- 60 days (2025-12-04): Add gleaning group support. Partner with 1-2 food banks/orgs. 20 total rescues.
- 90 days (2026-01-03): Automation complete. One week of transfers without founder intervention.
- 180 days (2026-04-03): Expand to 2-3 cities. 100 total rescues. Identify strongest user segment.
- 365 days (2026-10-05): Revenue model identified. 500+ rescues. <2 hrs/week maintenance required.

## Important Notes

- Validate input at system boundaries with Zod
- HTML: write semantically-meaningful and accessible markup
- Use SQLite for the data layer
- Use the ORM for simple operations; use SQL and prepared statements for complex ones
- `db:push` for local dev — diffs `schema.ts` against the live DB
- `db:migrate` for E2E tests and production — runs migration files tracked by a journal
- Do not mix: a DB created with `push` can't switch to `migrate` (and vice versa)
- Use Solid JS for reactive UI components
- Routes are defined using TanStack Router's file-based routing

### Authentication

- Better Auth with magic link (passwordless) authentication
- Server config: `src/lib/auth.ts`
- Client: `src/lib/auth-client.ts` - use `useSession()` hook for session state
- API routes at `/api/auth/*` handled by catch-all route
- Protected routes `/garden/mine` and `/garden/new` require authentication
- Magic links: set `RESEND_API_KEY` for email delivery, otherwise logs to console

## Known Issues

(none yet)

## Future Plans

(none yet)
