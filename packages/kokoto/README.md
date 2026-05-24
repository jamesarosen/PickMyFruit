# kokoto

Durable workflows and retriable steps for Pick My Fruit, backed by `_dc_*` tables in the app SQLite database and a single in-process Node runtime.

## Semantics

- **Step log exactly-once:** after `_dc_step` commits with `success`, replay returns stored output; the step function does not run again.
- **External at-least-once:** a crash after Resend/Tigris accepts work but before the step row commits can rerun the step. Use provider idempotency keys (e.g. Resend `Idempotency-Key` from `ctx.stepKey(name)`).

## CPU budget

Workflow orchestration runs on the Node event loop. Keep synchronous work inside steps to **≤16 ms**; offload Sharp and other heavy work to async I/O with queue concurrency limits (`media` queue concurrency 1).

## v1 scope

- `defineWorkflow`, `defineQueue`, `runtime.start` / `stop`, handles with `.result()` / `.cancel()`
- Enqueue delay via `runAt` on `scheduled_for` (not cron)
- No `ctx.sleep`, cross-language protocol, or multi-machine leader election

Email timing for welcome series and inquiry follow-ups belongs in Resend (`scheduled_at`), not in kokoto schedulers.

## App integration

Migrations live in `apps/www/drizzle/`. Boot order in `server-boot.server.ts`: migrations → `runtime.start()` → other workers.
