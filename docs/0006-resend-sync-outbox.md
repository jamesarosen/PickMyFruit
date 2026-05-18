# Resend contact sync via transactional outbox

## Summary

Integrate Pick My Fruit **user lifecycle** (create and profile update) with **Resend Audiences** using a **transactional outbox** stored in the same SQLite database as Better Auth. The **web app process** enqueues rows when Better Auth persists `user` rows; a **separate `resend-sync` process** on the **same machine** polls the outbox, calls the Resend API, and marks rows processed.

Email **templating** (moving magic-link and inquiry bodies into Resend Templates) is **orthogonal**; this doc covers **contact / audience sync** only.

**Related:** GitHub issue “Resend User Sync” (#237).

---

## Goals

1. When a **user record is created**, enqueue work to add or update the contact in Resend and attach them to the **Global** audience (exact API calls depend on Resend product surface at implementation time).
2. When a **user record is updated** (name, phone, email-related fields we care about), enqueue the same style of work.
3. **At-least-once delivery** to Resend with **safe retries** (idempotent upsert keyed by email).
4. **Failure isolation:** a Resend outage must not block sign-up or profile saves once the local DB commit succeeds.
5. **Service-ready shape:** stable **event envelope** and **ports** so we can later extract producers or consumers without redefining semantics.

---

## Non-goals

- Replacing transactional email (`sendMagicLink`, inquiry mail) with this pipeline.
- Guaranteed **sub-second** propagation (polling-based consumer); tight latency can be added later via wake signals or a relay.
- Running `resend-sync` on a **different host** than the SQLite file (would require a different storage or replication story).
- Introducing a **general-purpose job queue** or **durable compute platform** for this integration; the outbox table is deliberately narrow.

---

## Architecture

### Protocol: database as integration boundary

The contract between **producer** (Better Auth path in the web process) and **consumer** (`resend-sync`) is:

- **Shared SQLite file** on a volume mounted at `/app/data` in production (see `fly.toml` `[mounts]`).
- **Outbox table** rows = durable commands. No HTTP or Unix socket between web and sync is **required** for correctness.

Optional later enhancement: **best-effort wake** (HTTP ping to sync) to reduce poll latency; still **authoritative** source is the outbox table.

### Processes on one machine

| Process | Role |
|---------|------|
| **`app`** | Serves HTTP; Better Auth; **`databaseHooks`** insert outbox rows when `user` is created or updated. |
| **`resend-sync`** | Loop: claim pending outbox rows → call Resend → mark `processed_at`. |

**Fly.io:** define a second `[processes]` group (e.g. `resend_sync`) with its **own command** (Node script or `node apps/www/dist/resend-sync.js`), **same image**, **same volume**, **no public ports**. Use Fly’s multi-process docs ([Multiple processes](https://fly.io/docs/app-guides/multiple-processes/)).

**Local dev:** `docker-compose` (or `pnpm` scripts) run two containers or two processes sharing the same host path for `*.db`, mirroring production.

### Bounded contexts

- **Identity:** Better Auth owns `user` rows and emits integration events **only via outbox inserts** tied to those writes.
- **Delivery / integrations:** `resend-sync` owns translating outbox payloads into Resend API calls and retry bookkeeping.

---

## Data model

Add a Drizzle table (name illustrative):

**`resend_sync_outbox`**

| Column | Type | Notes |
|--------|------|--------|
| `id` | text PK | UUID |
| `event_type` | text | e.g. `user_created`, `user_updated` |
| `payload` | text | JSON; versioned schema (see below); includes `userId` and other fields Resend needs |
| `idempotency_key` | text UNIQUE | e.g. derived from `userId` + monotonic `updatedAt` or payload hash |
| `created_at` | integer (ms) | enqueue time |
| `processed_at` | integer (ms) nullable | set when Resend succeeded |
| `attempt_count` | integer | increment on failure |
| `last_error` | text nullable | truncated message for operator visibility |

**Optional `user_id` column / FK:** duplicating `userId` in the payload **and** adding `user_id REFERENCES user(id)` couples the outbox to the Better Auth schema and forces delete-policy decisions long before scale demands them. Prefer **`userId` only inside `payload`** unless we need SQL joins from `user` to pending rows (e.g. operational dashboards). If an FK is added later, treat it as an optimization, not a requirement for `resend-sync`.

**Indexes:** composite index on `(processed_at, created_at)` for the drainer query; unique on `idempotency_key` to collapse duplicate enqueues when appropriate.

**Migrations:** add SQL under `apps/www` Drizzle journal; set `when` in `drizzle/meta/_journal.json` to `Date.now()` at authoring time, strictly increasing per project rules.

---

## Event envelope (versioned)

Define a **single Zod schema** (recommended location: `packages/` once extracted, or `apps/www/src/lib/resend-sync/` until then) for `payload`:

- `schemaVersion` (number)
- `userId`, `email`, `name`, `phone` (and any other fields Resend needs)
- `occurredAt` (ISO or ms) for debugging
- **Optional telemetry:** `traceContext` (or similar) carrying **W3C `traceparent`** (and optional `tracestate`) captured when enqueue runs in the web process — see [Observability strategy](#observability-strategy).

**Producer rule:** only code paths that **commit** Better Auth `user` mutations may enqueue. Today that is **`databaseHooks.user.create.after`** and **`databaseHooks.user.update.after`** in `apps/www/src/lib/auth.server.ts` (or a module imported there).

**Techniques to enforce this rule (combine several):**

1. **Single writer module:** expose one **`enqueueResendSyncCommand(...)`** (or `OutboxWriter`) used **only** from `databaseHooks`; do not export raw table helpers for general use.
2. **Repository hygiene:** ban direct `insert(resendSyncOutbox)` outside that module — **code review**, **`grep`** in CI (`rg 'resend_sync_outbox'` must list only allowed files), or **eslint-plugin-import** `no-restricted-paths` / **Knip** unused-export checks so stray inserts surface quickly.
3. **Architectural decision:** short ADR or comment block at the hook registration site stating “no other enqueue sites”; any exception (e.g. future non-BA user writes) requires updating the ADR and tests.
4. **Tests:** integration test proves enqueue **only** when BA endpoints mutate `user`; optional **mutation coverage** audit when adding new auth plugins or profile APIs.
5. **Transaction discipline:** enqueue runs inside the hook body — never fire-and-forget `void enqueue()` from routes without the corresponding BA commit.

**Consumer rule:** validate payload with the same Zod schema; reject unknown `schemaVersion` with a clear error and ops guidance.

---

## Better Auth: `databaseHooks`

Use [Database hooks](https://better-auth.com/docs/concepts/database#database-hooks) on the **`user`** model:

- **`create.after`:** insert one outbox row (`user_created`).
- **`update.after`:** insert one outbox row (`user_updated`) when relevant fields change (optional optimization: compare before/after in `update.before` and skip enqueue if nothing material changed).

**Transaction co-location:** confirm whether `after` hooks run in the **same SQLite transaction** as the adapter’s `INSERT`/`UPDATE`. If yes, enqueue is **truly transactional** with the user row. If not, document the gap and consider reconciliation (rare orphan users) or a follow-up migration in Better Auth / adapter behavior.

**Errors:** if outbox insert fails, use `Sentry.captureException` per project conventions; avoid silent drops.

---

## `resend-sync` worker behavior

1. Poll every **N** seconds (configurable via env, low in dev, moderate in prod).
2. In a loop, **select** a batch of rows where `processed_at IS NULL`, ordered by `created_at`, `LIMIT` small (e.g. 50).
3. For each row: **upsert** contact in Resend and add to Global audience; on success set `processed_at`.
4. On failure: increment `attempt_count`, set `last_error`, apply **exponential backoff** (sleep or skip until next poll); cap attempts and alert via Sentry after threshold.
5. **Idempotency:** Resend upsert by email so retries remain safe.
6. **Retention:** periodically remove **completed** rows so the outbox does not grow without bound. **`processed_at IS NOT NULL`** and older than **`RESEND_SYNC_OUTBOX_RETENTION_MS`** (env; **default:** `7` days → `604_800_000` ms). **Never** delete rows that are still pending (`processed_at IS NULL`). Implement pruning with a **CTE** so the delete is explicit and easy to extend (e.g. logging `RETURNING`):

```sql
WITH deleted AS (
  DELETE FROM resend_sync_outbox
  WHERE processed_at IS NOT NULL
    AND processed_at < :cutoff_ms
  RETURNING id
)
SELECT count(*) AS pruned FROM deleted;
```

Run this **after** normal processing updates (same poll tick or every **K** polls). **`cutoff_ms`** = `now_ms - RESEND_SYNC_OUTBOX_RETENTION_MS`. Combine into **one transaction** with batch `UPDATE`s that set `processed_at` when that simplifies rollback behavior.

If a future optimization needs **one round-trip** that both marks rows processed and prunes stale ones, keep the **prune leg** as a CTE-style `DELETE` (possibly in the same `BEGIN … COMMIT` as the updates), rather than ad hoc multi-statement deletes scattered through the worker.

**Environment:** `RESEND_API_KEY`, audience / segment identifiers, database path identical to web (`DATABASE_URL` or file path already used by `apps/www`), **`RESEND_SYNC_OUTBOX_RETENTION_MS`** (retention for rows with `processed_at` set).

**Logging:** structured `logger` from `@/lib/logger.server` (or a small shared logger if the worker moves out of `apps/www`).

### Unix signals (graceful shutdown and wake-up)

**`SIGTERM`** (and **`SIGINT`** locally): orchestrators (Fly, Docker, systemd) expect **fast, clean exit**. Register handlers that:

1. Set a **`shutdownRequested`** flag (or abort an `AbortController` shared by the poll loop).
2. **Stop scheduling new poll cycles**; let the **current** cycle finish **or** stop **after the current outbox row** — pick one policy, document it, and test it. Finishing the **current row** before exit avoids leaving “Resend succeeded but `processed_at` not committed” if the process is killed mid-update.
3. **Close** the database connection / pool.
4. **Flush** OpenTelemetry (`shutdown()` on the SDK/provider) so spans export.
5. **`process.exit(0)`** (or propagate non-zero only on failed cleanup).

Use a **timeout**: if cleanup exceeds Fly’s machine stop grace period, exit anyway so the platform does not **`SIGKILL`** blindly — log that truncation occurred.

**`SIGKILL`:** uncatchable; **idempotent** Resend upserts and **retryable** outbox rows must tolerate a kill **between** HTTP success and `UPDATE processed_at`.

**Is `SIGCONT` a best-effort wake-up?** **No.** `SIGCONT` **only resumes** a process that was **stopped** (`SIGSTOP` / `SIGTSTP`). A worker that is merely **sleeping** between polls is not stopped; **`SIGCONT` does not wake** `setTimeout`/`Atomics.wait`-style delays and is the wrong tool. Prefer:

- **`SIGUSR2`** (or **`SIGHUP`**) handler setting **`runCycleNow`** / waking an **`AsyncCondition`**, or
- **Loopback HTTP** `POST` (e.g. `127.0.0.1`) if you already run a minimal admin bind, or
- **`RESEND_SYNC_POLL_MS`** very low in dev/CI.

Document the chosen mechanism in the runbook; avoid repurposing **`SIGCONT`**.

---

## SQLite PRAGMAs (WAL, synchronization)

Two processes on one host (**web** + **`resend-sync`**) both open the **same database file**. Separate OS processes do **not** share SQLite’s in-memory cache; coordination is via **file locking** on the DB file, which is sufficient for this pattern.

**Recommendations:**

- **`journal_mode=WAL`:** Allows **one writer and concurrent readers** with less friction than rollback mode for our pattern (web writes users + outbox; sync reads and updates outbox). WAL is the usual default for server-style SQLite workloads. Set **once** at connection open (both processes), e.g. `PRAGMA journal_mode=WAL;`.
- **`synchronous=NORMAL`:** Often paired with WAL for a good balance of durability and performance. **`FULL`** is stricter (more fsync cost); pick explicitly if policy demands maximal durability on single-machine power loss.
- **`busy_timeout`:** Non-zero (e.g. **5000** ms) on **both** connections reduces `SQLITE_BUSY` failures when the web process writes and the worker briefly locks the DB.

**Current codebase:** the app does not yet centralize PRAGMA setup in one place; **implementation** should open the DB with the same PRAGMAs in **both** the web server and `resend-sync` so behavior is consistent.

**Not strictly required** for correctness if defaults already enable WAL in the driver—verify what `better-sqlite3` / Drizzle / libSQL stack emits on Fly. If defaults are rollback journal or `busy_timeout=0`, **adjust** to match the above for smoother multi-process operation.

---

## Deployment wiring (checklist)

- [ ] **`Dockerfile` / entrypoints:** build artifact includes `resend-sync` entry (same Node image as web).
- [ ] **`fly.toml`:** second process group; **no** HTTP service for sync; same `[[mounts]]`.
- [ ] **Secrets:** Resend keys and audience IDs available to **`resend-sync`** process (Fly secrets apply to the app; scope by process if needed).
- [ ] **Docs / runbooks:** how to drain backlog, interpret `last_error`, reprocess dead rows.

---

## Observability strategy

**Spans / traces**

- Treat **each `resend-sync` poll cycle** (select batch → process → prune) as one **OpenTelemetry trace root** for the worker, or nest **one span per outbox row** under a short-lived **“poll cycle”** parent span so backlog bursts stay readable.
- Wrap **Resend HTTP** and **SQLite updates** (`processed_at`, retries) in child spans with attributes: `outbox.id`, `event_type`, `attempt_count`, outcome.

**Linking producer (web) ↔ consumer (sync)**

- These run in **different processes**; the backend exporter does **not** stitch traces automatically.
- **Recommended:** add optional **`traceparent`** (W3C Trace Context) to the payload (`traceContext.traceparent`, optional `traceContext.tracestate`) **at enqueue time**, extracted from the **active span** in the hook when an HTTP request is in flight (sign-up / profile update). For rare jobs not tied to a request, omit the field.
- In **`resend-sync`**, **extract** that context and either:
  - start a span that is a **child** of the propagated parent (when the SDK supports extraction from `traceparent`), or
  - start a new trace and add a **span link** to the producer span (preferred for **async** handoffs in many backends — preserves causality without pretending same trace timing).

**Logs and errors**

- Correlate `logger` fields with **`trace_id`** / **`span_id`** when OTEL log correlation is enabled.
- Permanent failures: **`Sentry.captureException`** with `outbox.id` and user identifiers allowed by policy.

**`SQLITE_BUSY`**

- Record **busy-retry count or duration** on the poll-cycle span (or a dedicated metric); see [Risks and mitigations](#risks-and-mitigations).

---

## Testing strategy

### Unit tests

- Zod envelope: valid / invalid payloads, version negotiation.
- Idempotency key generation (deterministic).
- Drainer **without network:** mock Resend client; assert state transitions on the outbox table.

### Repo-wide integration test (recommended)

- Stub Resend at the HTTP client boundary used by the worker.
- Run **web** + **`resend-sync`** (or call an exported `drainOnce()` after the HTTP request in CI for determinism).
- Drive a **real user update** through Better Auth’s HTTP API against a **test SQLite** file.
- Assert the stub received an upsert with expected email/name **after** enqueue (immediate `drainOnce()` **or** bounded wait with worker poll interval tuned for CI).

Wall-clock **“within X ms”** assertions are flaky under load; prefer **synchronous drain** for correctness tests and a separate **timing-tolerant** test if needed.

### E2E

Optional; integration coverage is usually sufficient for outbox + worker.

---

## Red–green double-loop TDD (**required**)

Use **red–green double-loop TDD** for this feature: **outer** (integration) loop and **inner** (unit) loop per [Testing strategy](#testing-strategy).

The **exact scenarios** below are **suggested** defaults; adjust if a ticket narrows scope, but do **not** skip the double-loop discipline.

**Suggested outer loop:** failing integration test — user created/updated → outbox row exists → Resend stub sees call.

**Suggested inner loops:** envelope schema, single-writer enqueue helper, drainer claim/mark functions — each with its own unit tests.

Implement **minimal** code to green the inner test, then the outer, then refactor.

---

## Sequence (commits)

Break implementation into **small commits**. Each commit should ship an **observable, testable** outcome (prefer **deterministic** unit or integration tests; avoid timing-dependent assertions unless isolated).

| # | Commit focus | Testable output (examples) |
|---|----------------|---------------------------|
| 1 | **`resend_sync_outbox` schema** + Drizzle + SQL migration + journal entry | Migration applies on empty DB; `sqlite_master` / Drizzle introspection shows table and indexes; `pnpm db:migrate` (or project equivalent) passes in CI. |
| 2 | **Versioned payload** — Zod schema + `idempotency_key` helper (+ optional `traceContext`) | Unit tests: valid/invalid payloads; deterministic key for same inputs; unknown `schemaVersion` rejected. |
| 3 | **`OutboxWriter` only** (no hooks yet) | Unit/integration: call writer with fixture payload → **exactly one** row inserted; duplicate idempotency key **fails** or **no-ops** per chosen strategy (assert which). |
| 4 | **Better Auth `databaseHooks`** — `user.create.after` / `user.update.after` → writer | Integration: drive BA **create/update** (server fn or HTTP) → row count + payload fields match (no Resend). |
| 5 | **`resend-sync` entrypoint** — parse env, open DB (shared PRAGMAs), **no-op loop** or **dry-run** | Subprocess test: process **starts**, logs/version exits **0**; or stays up until **SIGTERM** → **exit 0** within timeout **without** unhandled rejection. |
| 6 | **Signal handling** — `SIGTERM` / `SIGINT` cleanup | Subprocess: start worker → **`SIGTERM`** → exits **0**, DB file still valid; optional assert OTEL flush hook invoked (mock exporter). |
| 7 | **`processOneCycle`** (or equivalent) — select batch, **mock Resend**, update `processed_at` | **Deterministic unit test:** seed **`N`** pending rows, **`batchSize=1`**, one cycle → Resend stub called **once**, **`N-1`** pending rows remain (and **one** row has `processed_at` set). Variants: `batchSize=k`, assert counts accordingly. |
| 8 | **Resend mapping** — real upsert + audience API behind interface | Contract test with **HTTP mock** (MSW/`fetch` mock): correct URL/method/body; failure path increments `attempt_count` and does **not** set `processed_at`. |
| 9 | **Retention CTE** — delete processed rows older than cutoff | Unit test on `:memory:` SQLite: seed old processed + new processed + pending → run prune → **only** eligible processed rows removed. |
| 10 | **Polling loop** + backoff + wire **`DRAIN_NOW`** signal (`SIGUSR2` or chosen wake) | Unit: fake clock or inject `sleep`; assert wake triggers immediate cycle. Optional subprocess: **not** required for every PR. |
| 11 | **Fly / Docker** — second `[processes]` entry, same image, same volume | **Smoke:** `fly deploy` preview or **CI** build image and run **`docker run … resend-sync`** with test DB + **`SIGTERM`** (non-required E2E). |
| 12 | **OTEL** — poll-cycle trace + payload `traceparent` extraction | Integration with **InMemorySpanExporter**: one cycle yields expected span tree; **or** attribute assertions only. |

**Non-required examples** (add when helpful):

- Subprocess: worker **obeys `SIGTERM`** under load (see commit **6**).
- Unit: **`N` rows → one cycle → `N-1` pending** (see commit **7**).
- **Integration / E2E happy path:** web user update → outbox row → worker drains → Resend stub sees expected payload (prefer **`drainOnce()`** after request in CI for determinism).

Reorder commits if schema and Zod must land together; **do not** merge “migration + worker + Fly” without tests for each slice.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| SQLite **single-writer** contention | Small batches, short transactions in worker; surface **`SQLITE_BUSY`** in **observability** — attribute or event on the **poll-cycle OTEL span** (and/or a counter metric: busy count, total wait ms) so contention shows up in traces and dashboards. |
| Hooks not transactional with user write | Verify adapter behavior; add periodic reconciliation job later if needed. |
| Profile updates **outside** Better Auth | Document; add second enqueue site or route all updates through BA. |
| Duplicate events | Unique `idempotency_key` + Resend idempotent upsert. |

---

## Future work

### A. Extract **only `resend-sync`** (smallest service boundary)

- Move worker to `apps/resend-sync` or `workers/resend-sync` with **shared** `packages/resend-sync-contract` (Zod + types).
- Keep Better Auth and hooks in **`apps/www`**; producer still writes to the **same** SQLite file on the shared volume (**same Fly app**, two machines/process groups): lowest operational change.
- Sync process scales independently (CPU for retries, separate restart).

### B. Extract **API service** (web thin client; auth + domain HTTP elsewhere)

- Move Better Auth, Drizzle, SQLite, and **`databaseHooks`** to a dedicated **Auth / API** deployable that owns the **`user` table and outbox**.
- **`apps/www`** becomes static + browser calls to the API (cookies/CORS/session domains must be redesigned — highest effort).
- **`resend-sync`** reads the **same outbox** via **network-attached storage is not SQLite** — so this step usually implies **Postgres** (or SQLite replication) **or** an **outbox relay** (Auth writes outbox → relay publishes to NATS/SQS → sync consumes). Plan the **storage migration** before assuming SQLite spans services.

### C. Extract **Better-Auth-plus-Resend-sync** as one service

- Only coherent if that service **also owns all user writes** (i.e. it **is** the Auth/API from B). Putting **only** a background worker with Better Auth **without** request-path auth is not viable: hooks must run where commits happen.
- Practical compromise: **monolithic Auth+API** binary that runs **both** HTTP (Better Auth) **and** an **in-process or companion `resend-sync` process** — same release, two processes — until storage is split.

### Contract stability across A–C

Keep **`packages/resend-sync-contract`** (or equivalent) as the **only** shared semantics for enqueue payloads. Swap **transport** later (outbox row → queue) without renaming events: **relay** reads SQLite outbox and publishes to a broker; **`resend-sync`** becomes a generic consumer. The web/API producer continues to insert rows until the relay owns replication.

### D. General-purpose job queue and durable compute

If the outbox table or polling worker becomes a bottleneck, or we need **cross-service**, **scheduled**, or **orchestrated** side effects, promote delivery to a **general-purpose queue** (e.g. SQS, NATS, Cloud Tasks) or **durable workflows** (step functions, Temporal-style compute). That path is explicitly **out of scope** for the first slice (see Non-goals) but is the natural evolution once reliability or topology demands it.

Tracked exploration:

- [#123](https://github.com/jamesarosen/PickMyFruit/issues/123)
- [#126](https://github.com/jamesarosen/PickMyFruit/issues/126)

---

## References

- Better Auth — [Database hooks](https://better-auth.com/docs/concepts/database#database-hooks)
- Fly.io — [Run multiple processes](https://fly.io/docs/app-guides/multiple-processes/)
- Project conventions — `AGENTS.md`, `CLAUDE.md` (migrations, logging, Sentry)
