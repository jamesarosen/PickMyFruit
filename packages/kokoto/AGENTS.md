# AGENTS — @pickmyfruit/kokoto

Guidance for AI/coding agents working inside this package.

## Module layout

- `src/index.ts` — public API surface (re-exports). Safe for client-graph
  imports; carries only types and helpers that do not touch SQLite.
- `src/runtime.server.ts` — the runtime (`DurableRuntime`, `createRuntime`).
  Touches SQLite directly; must only be reached from `*.server.ts(x)` files.
- `src/worker.server.ts` — per-workflow execution: step replay, ctx, finalize.
- `src/sql.server.ts` — every prepared statement the runtime issues.
- `src/schema.server.ts` — canonical `_dc_*` DDL. Host apps copy into their
  migration journal. Keep in sync with `WorkflowRow` / `StepRow`.
- `src/registry.ts` — `defineWorkflow` / `defineQueue` + in-memory registry.
- `src/types.ts` — exported types; no runtime behaviour.
- `src/errors.ts` — all `*Error` classes.
- `src/telemetry.server.ts` — single choke point for metrics/logs.
- `src/uuidv7.ts` — UUIDv7 generator (lexicographically sortable).

## Rules

- **Determinism in workflow bodies.** Anything outside `ctx.step()` is replayed
  on recovery; do not call `Date.now()`, `Math.random()`, or any I/O outside a
  step. Workflows should use `ctx.now()` for timestamps.
- **Step ids are positional.** `ctx.step("foo", fn)` first call gets `step_id =
"foo"`. The second call to the same name gets `foo#2`. Lint forbids
  `Promise.race` on steps because it makes the order non-deterministic.
- **Payloads are capped at 1 MB.** `encodePayload` enforces this in the JS
  layer; the SQL CHECK constraint is defence in depth.
- **All SQL goes through `sql.server.ts`.** Do not inline `client.execute` calls
  in `runtime.server.ts` or `worker.server.ts`. This keeps the prepared
  statements reviewable in one place.
- **Telemetry is optional.** Every metric/log call must work when no sink is
  configured — keep using the `Telemetry` wrapper, never call `Sentry.*`
  directly from this package.
- **No external errors in the package.** All thrown errors must extend
  `KokotoError` so consumers can catch the family with one `instanceof` check.
- **File naming.** Anything that imports `node:*`, opens a SQLite connection,
  or touches secrets must be `*.server.ts`. The public type entry (`index.ts`)
  stays client-safe.
- **No env reads, no dotenv, no standalone dev mode.** The runtime takes a
  pre-built `SqlClient` from the host. Do not add `process.env.DATABASE_URL`
  lookups, a `pnpm dev` script, or a `dotenv`/`dotenvx` dependency — at
  runtime the host (`apps/www`) owns env; under `pnpm --filter
@pickmyfruit/kokoto test:run` tests build their own in-memory client.

## Testing

- Unit tests live in `test/` and run via `pnpm --filter @pickmyfruit/kokoto
test:run`.
- Tests create an in-memory libsql database with `createClient({ url:
'file::memory:' })` and call `runtime.createSchema()`.
- When asserting step replay, kill the dispatcher (`runtime.stop()`), create a
  new runtime against the same DB, and observe that `_dc_step` rows are
  returned from cache.

## When adding to v1

1. Update `KOKOTO_DDL` in `schema.server.ts` first.
2. Update the host app's migration journal (`apps/www/drizzle/`) to apply the
   same DDL — see `apps/www/drizzle/0008_add_kokoto.sql` for the pattern.
3. Extend `WorkflowRow` / `StepRow` types in `sql.server.ts` to match.
4. Add a test that exercises the new schema + behaviour against a fresh
   in-memory DB.

## Deferred (do not silently add)

Items on the v1 "deferred" list — `_dc_schedule`, `_dc_lease`, `ctx.sleep`,
`send`/`recv`, child workflows, saga helpers — must not appear here without an
issue plan amendment. They were cut from v1 explicitly.
