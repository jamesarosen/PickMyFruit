# @pickmyfruit/kokoto

DBOS-inspired durable workflow runtime for SQLite.

Workflows, steps, named queues with bounded concurrency, and crash-recovery —
all backed by `_dc_*` tables in an existing SQLite database. No Postgres, no
Redis, no broker. One Node process, one SQLite file.

> v1 scope. See the [issue plan](https://github.com/jamesarosen/PickMyFruit/issues/268)
> for what is and is not in scope.

## Why durable compute?

The host app needs side-effects that survive process crashes — sending emails,
processing photos, syncing contacts to Resend. Without durability, a SIGKILL
in the middle of "send email → write inquiry row" leaves the user looking at a
success page and the owner with no email. With kokoto, each side-effect is a
`step` whose output is committed to SQLite before the workflow proceeds; on
crash, the workflow resumes from the last committed step.

## Quickstart

```ts
import { createClient } from '@libsql/client'
import { createRuntime, defineQueue, defineWorkflow } from '@pickmyfruit/kokoto/runtime.server'

const emailQueue = defineQueue('email', { concurrency: 4 })

const submitInquiry = defineWorkflow(
	'submitInquiry',
	async (ctx, input: { listingId: number; gleanerId: string }) => {
		await ctx.step('sendOwnerEmail', () =>
			resend.emails.send({
				/* ... */
				idempotencyKey: ctx.stepKey('sendOwnerEmail'),
			})
		)
		await ctx.step('createInquiry', () => db.insert(inquiries).values({ ...input, emailSentAt: ctx.now() }))
		return { ok: true }
	},
	{ queue: 'email' }
)

// kokoto does not open its own DB connection — the host injects one. In
// `apps/www` this is the same `libsqlClient` that powers Drizzle, so the
// runtime shares the process's connection pool and pragmas.
const client = createClient({ url: 'file:./data/app.db' })
const runtime = createRuntime({ client })

await runtime.createSchema() // tests only; production uses the migration journal
await runtime.start({ workflows: [submitInquiry], queues: [emailQueue] })

const handle = await runtime.startWorkflow(submitInquiry, { listingId: 42, gleanerId: 'usr_abc' }, { idempotencyKey: `inquiry:42:usr_abc:2026-05-24` })
await handle.result({ timeoutMs: 60_000 })
```

## Semantics

| Term                       | Meaning                                                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Step log exactly-once**  | After `_dc_step` commits with `success`, replay returns stored output; the user fn for that step does not run again.                                                                                        |
| **External at-least-once** | If the process crashes after Resend/Tigris accepts work but before the `_dc_step` row commits, the step runs again. Mutating steps must supply an `Idempotency-Key`, content-addressed key, or DB sentinel. |
| **Workflow id**            | Primary key on `_dc_workflow`. Caller-supplied or UUIDv7. Used by `handle.result()` / `runtime.cancel()`.                                                                                                   |
| **Idempotency key**        | Optional UNIQUE column on `_dc_workflow`. On conflict the existing row's id is returned — the caller never sees a duplicate workflow.                                                                       |

### CPU budget

Workflow orchestration runs on the Node event loop. **Steps should target ≤16ms
of synchronous CPU.** Anything heavier (Sharp, large JSON parses) should run in
an async step that yields, with the workflow routed onto a small-concurrency
queue (e.g. `media`, concurrency `1`).

### Determinism

Workflow bodies are re-executed during recovery. Anything outside `ctx.step()`
must be deterministic — no `Date.now()`, no `Math.random()`, no I/O. Use:

- `ctx.now()` — returns the workflow's `started_at`, deterministic across replays.
- `ctx.stepKey(name)` — stable per-step key for provider idempotency headers.

The repo-wide ESLint rule on `**/*.workflow.{ts,tsx}` (configured in the host
app, not this package) enforces this.

## Schema

All kokoto state lives in `_dc_*` tables. The canonical DDL is exported as
`KOKOTO_DDL` so the host app can copy it into its migration journal:

```ts
import { KOKOTO_DDL } from '@pickmyfruit/kokoto'

for (const stmt of KOKOTO_DDL) {
	await client.execute(stmt)
}
```

| Table          | Purpose                                                                                         |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `_dc_workflow` | One row per durable workflow. Status, queue, input/output, idempotency key, executor ownership. |
| `_dc_step`     | One row per logical step. Composite PK `(workflow_id, step_id)`. Stores cached output or error. |
| `_dc_executor` | One row per process boot. Used to identify and recover workflows owned by a dead executor.      |
| `_dc_meta`     | Key/value bag (`protocol_version`, future entries for full-integrity-check timestamps, etc.).   |

JSON payloads (`input`, `output`, `error`) are capped at 1 MB. The runtime
throws `PayloadTooLargeError` rather than producing a `CHECK` violation at the
SQLite layer.

## Recovery

When `runtime.start()` is called it:

1. Runs `PRAGMA quick_check`. A non-`ok` result throws `BootIntegrityError`
   so the host can fail closed (exit, alert, etc.). The dispatcher does not
   start.
2. Inserts a new `_dc_executor` row whose id becomes this boot's `executor_id`.
3. Resets any `running` row owned by a different executor back to `pending` so
   it can be re-claimed.

Steps already committed to `_dc_step` are returned from cache on replay; the
user function does not run again.

## Cancellation

`handle.cancel()` (or `runtime.cancel(id)`) sets `cancel_requested_at` and:

- `pending` rows transition straight to `cancelled`.
- `running` rows complete their current step, then `DurableCancelledError` is
  thrown at the next `ctx.step()` boundary. The workflow is finalised as
  `cancelled`.

## Observability

The runtime emits low-cardinality metrics through the optional `telemetry` sink.
Wire it up to Sentry like this:

```ts
import { Sentry } from '@/lib/sentry'
import { logger } from '@/lib/logger.server'
import { createRuntime } from '@pickmyfruit/kokoto/runtime.server'

createRuntime({
	client,
	telemetry: {
		incrementCounter: (name, value, attrs) => Sentry.metrics?.increment(name, value, { tags: attrs }),
		recordDistribution: (name, value, attrs) => Sentry.metrics?.distribution(name, value, { tags: attrs }),
		captureException: (err, ctx) =>
			Sentry.captureException(err, {
				tags: ctx,
				fingerprint: ['kokoto', ctx?.workflow ?? 'unknown', ctx?.step ?? ''],
			}),
		logInfo: (fields, msg) => logger.info(fields, msg),
		logDebug: (fields, msg) => logger.debug(fields, msg),
		logWarn: (fields, msg) => logger.warn(fields, msg),
	},
})
```

Emitted metric names (see `Metrics` export):

- `kokoto.workflow.enqueued`, `.dispatched`, `.finished`, `.recovered`, `.replay`
- `kokoto.step.started`, `.finished`, `.failed`, `.replayed`
- `kokoto.step.duration_ms` (distribution)
- `kokoto.dispatch.claimed`
- `kokoto.boot.quick_check_failed`

Attributes are restricted to `workflow.name`, `step.name`, `queue`, and
`status` / `outcome`. Workflow ids, user ids, and emails are **never** emitted.

## Not in v1

See the issue plan for the full list. Notable cuts kept for follow-ups:

- Time-based scheduling (`ctx.sleep`, `defineSchedule`, cron). Delayed email
  uses Resend's `scheduled_at` instead.
- Multi-process leader election (`_dc_lease`, heartbeat reclaim).
- Workflow-to-workflow messaging (`send`/`recv`, `setEvent`/`getEvent`).
- Per-key concurrency, child workflows, saga compensation helpers.
- Automated retention (`system.gc`); manual SQL pruning is acceptable at v1
  row volumes.

## Known limitations

### Scale-to-zero stalls future-dated work

The dispatcher lives in the host's web process. On Fly, machine idleness is
measured by inbound HTTP traffic — not by event-loop activity — so any
workflow with a future `scheduled_for` (a retry awaiting backoff, or a
delayed enqueue) does **not** advance while the machine is stopped.
Interactive work that the request itself drains is fine: the machine is
warm for the lifetime of the request. The failure modes that hurt are
retries during a provider outage (e.g. Resend 5xx) and any future-dated
welcome / follow-up enqueues, which only advance when the next inbound
request happens to wake the machine.

Mitigations (out of v1 scope): a periodic wake from a tiny "tickler"
process hitting a long-poll endpoint over Fly 6PN, or running the
dispatcher in a non-autostop process group. Until then, keep retry
budgets short and prefer provider-side scheduling (Resend `scheduled_at`)
over kokoto delays.

Pairing this with the current retry cadence — `250ms · 2^attempt`, capped
at 60s, three attempts — means a multi-minute provider outage exhausts
retries inside a single wake. When wake-aligned retries land (issue
follow-up), the backoff floor should match the wake interval and
`max_attempts` should raise so an outage rides across several ticks
instead of dying in one.

### Rolling deploys can duplicate-execute in-flight workflows

Boot recovery resets any `running` row whose `executor_id` differs from
the booting process to `pending`. During a rolling deploy the old machine
and the new machine are briefly both alive: the new boot's reclaim sweep
yanks the old machine's in-flight workflows back to `pending`, and both
machines may then dispatch the same workflow. Side effects with
idempotency keys (Resend `Idempotency-Key`, kokoto `ctx.txStep`) absorb
the duplicate; bare `ctx.step` calls without a key may run twice.

Mitigation (out of v1 scope): switch from identity-based reclaim to
lease-based, with a `claim_expires_at` column and a lazy expiry sweep
inside `claimPending`. Until then, prefer non-rolling deploys
(`strategy = 'immediate'` on Fly) when you have workflows in flight, or
ensure every external-effect step is naturally idempotent.
