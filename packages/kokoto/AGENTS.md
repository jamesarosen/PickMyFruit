# kokoto package

Server-only durable compute (`*.server.ts`). Do not import from client graphs.

## Layout

- `runtime.server.ts` — process singleton, boot/stop, enqueue
- `dispatcher.server.ts` — claim loop, queue/global concurrency
- `store.server.ts` — `_dc_*` SQL
- `context.server.ts` — `ctx.step()`, `ctx.now()`, `stepKey()`
- `telemetry.server.ts` — Sentry metrics (low-cardinality attributes only)

## Conventions

- Workflow definitions in the app use `src/workflows/*.workflow.ts`
- No `Date.now()`, `Math.random()`, or I/O outside `ctx.step()` in workflow bodies
- Pass `client` from `@libsql/client` (same file as Drizzle) into `runtime.start()`
