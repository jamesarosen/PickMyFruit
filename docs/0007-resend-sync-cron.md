# Resend contact sync via cron-style cursor worker

## Summary

Keep Pick My Fruit's **user lifecycle** (create, profile update) in sync with **Resend** (Contacts + Topics) using a **small worker** that runs as a Fly **scheduled machine**. On each scheduled run, the worker asks the web app over an internal HTTP API for the next user changed since the last successful sync, calls Resend, advances a cursor stored in a small file on the Fly volume, and exits 0. There is **no jobs table**, **no outbox**, and **no producer-side enqueue discipline** — the `user` table is itself the queue.

Email **templating** (moving magic-link and inquiry bodies into Resend Templates) is **orthogonal**; this doc covers **contact / audience sync** only.

**Related:**

- GitHub issue "Resend User Sync" (#237).
- Supersedes the outbox proposal in PR #239 (`docs/0006-resend-sync-outbox.md` on `cursor/resend-sync-outbox-plan-1755`). That design is preserved for posterity in the PR; this doc is the version we intend to implement.

---

## Goals

1. When a **user record is created** or **updated**, eventually upsert the contact in Resend and subscribe them to the **Newsletter** topic (Resend Topics API).
2. **At-least-once delivery** with **safe retries** (Resend upsert is idempotent by email).
3. **Failure isolation:** a Resend outage must not block sign-up or profile saves.
4. **Minimal surface area:** no new producer code paths; no new schema beyond the existing `user(updated_at, id)` index.
5. **Establish the standard pattern** for async work in this project until we graduate to a job queue or durable workflow engine. Future workers should be cheap to add — a new `apps/<worker>` directory, not a new toolchain.

---

## Non-goals

- Sub-minute propagation. The worker polls on an interval; latency = poll interval + Resend round-trip.
- A general-purpose job queue, outbox, or workflow engine.
- Running the worker on a **different machine** from the web app. The two share a Fly volume for the cursor file and reach the web app over its `.flycast` private hostname.
- Replacing transactional email (`sendMagicLink`, inquiry mail) with this pipeline.

---

## Architecture

### One machine, two processes, two packages

| Process           | Package            | Role                                                                                                                    |
| ----------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **`app`**         | `apps/www`         | Serves public HTTP; Better Auth writes `user` rows as usual. Adds a small `/internal/v1/*` API used only by the worker. |
| **`resend_sync`** | `apps/resend-sync` | Fly **scheduled machine** (hourly). Each invocation drains the user queue once and exits 0. Not a `[processes]` group.  |

The `app` process group is provisioned via `[processes]` in `fly.toml`; `resend_sync` is provisioned once with `fly machine run . --schedule hourly --command "node apps/resend-sync/dist/main.js"`. Both run from the **same Docker image** and attach the same `data` volume at `/app/data`. Only `app` exposes a public service.

**Why a scheduled machine, not a process group?** Earlier revisions of this doc proposed a long-running `[processes] resend_sync` worker that wakes on `RESEND_SYNC_POLL_MS`. Fly's process groups produce always-on Machines, so that model burns CPU/RAM/$ on an idle worker 99% of the time — and "increase poll frequency" is the wrong knob to add resilience to a job that's actually idle. Fly's scheduled-machine primitive is purpose-built for finite tasks: it starts on schedule, runs the command, exits. Loss of a poll iteration is just a missed schedule (next hour catches up — the cursor is durable), and the observability story is better (one machine per run, distinct log streams).

**Why a separate package, not a second entry point in `apps/www`?** The previous revision of this doc deferred extraction "until a second integration justifies the package boundary." That bet has been falsified by the first integration: keeping the worker inside `apps/www` forced a 27-line `--define:import.meta.env.VITE_*` block in the Dockerfile to fake out Vite's build-time replacement, plus a vitest project carve-out and libsql resolution workarounds for a process that wants none of those things. Each future worker would inherit and amplify that tax. Doing the extraction now sets the cheap precedent: each new worker is a plain Node package with `process.env`, `@sentry/node`, and a tsc build — no Vite, no jsdom, no `import.meta.env` shimming.

**Why not import the web app's DB client directly?** Considered and rejected. Cross-app imports break the `apps depend on packages` convention, couple the worker's build to web-only tooling (TanStack Start's import-protection, Vite paths), and recreate the toolchain mixing the extraction was meant to end. The two options worth considering are a `packages/db` workspace and an internal HTTP API. We chose the **HTTP API** for forward flexibility: the next async integration may want to be a binary (Go, Rust) running on a separate Machine, and an HTTP boundary is the only choice that lets us swap implementation language and topology without rewriting both sides.

**Why Fly scheduled machines instead of a cron container (Supercronic, etc.)?** Supercronic and similar in-container cron daemons assume an always-on machine — exactly the cost profile a scheduled job should avoid. Fly's scheduled-machine primitive boots a Machine on the schedule, runs the command, and stops the Machine. One job, one scheduling primitive, no extra container. Revisit if we ever need finer granularity than `hourly` or job-level retries Fly doesn't offer (Cron Manager blueprint).

The web process never imports worker code; the worker never serves HTTP and never opens the user database.

### Diagram

```mermaid
flowchart LR
  U[HTTP client] --> W[apps/www<br/>Better Auth]
  W -->|INSERT/UPDATE user| DB[(SQLite on /app/data)]
  S[apps/resend-sync<br/>poll loop] -->|GET /internal/v1/users/next?cursor=…| W
  W -->|SELECT user WHERE updated_at,id > cursor LIMIT 1| DB
  W -->|{ user, nextCursor }| S
  S -->|view + create/update contact| R[Resend API]
  S -->|write cursor.json| V[(Fly volume /app/data/resend-sync)]
```

---

## Internal HTTP API

The worker reaches the web app over Fly's **private 6PN network** at `http://pickmyfruit.flycast`. This keeps internal traffic off the public internet and avoids needing a TLS certificate for an internal hostname. The shared secret in `x-internal-auth` is the **primary** perimeter; the private network is defense-in-depth.

### Endpoint

```
GET /internal/v1/users/next?cursor=<opaque-string>
Headers:
  x-internal-auth: <secret>
```

Responses:

- **200** `{ "user": { "id", "email", "name" } | null, "nextCursor": "<opaque-string>" }`. When `user` is `null`, the queue is drained; the worker still persists `nextCursor` (it equals the request cursor) and exits 0 until the next scheduled run.
- **404** for any unknown route OR a missing/invalid secret. Returning the same 404 shape as any unknown URL avoids volunteering that `/internal/*` exists. Do **not** return 401 — that distinguishes "endpoint exists" from "endpoint doesn't" to an unauthenticated probe.
- **5xx** for upstream DB errors. Worker treats this exactly like a Resend 5xx (see [Failure semantics](#failure-semantics)).

### Cursor opacity

The cursor is an **opaque string** to the worker. Today it encodes `(updated_at, id)` (e.g. base64-encoded JSON), but only the API owns that. The worker round-trips whatever it received. This means the worker has zero knowledge of the `user` schema — the only contract is the response shape above.

### Auth

- Header is `x-internal-auth: <secret>`. Reserve `Authorization: Bearer …` for future public API keys.
- Compare with `crypto.timingSafeEqual` against `Buffer`s of equal length (length-pad both sides before comparison to avoid leaking length).
- Two secrets are valid at once: `INTERNAL_API_SECRET` and (optional) `INTERNAL_API_SECRET_PREVIOUS`. This enables rotation without a coordinated deploy.
- Strip `/internal/*` from sitemaps, OpenAPI, and any robots/SEO output. Do not log the `x-internal-auth` header anywhere — add a scrubber to the request logger and to Sentry's `beforeBreadcrumb`. Cover both with a test.
- Per-IP rate limit on `/internal/*` even with a valid secret (e.g. 30 req/sec). Bounds blast radius if the secret leaks.

### TLS-redirect carve-out

`apps/www/src/middleware/tls.ts` currently redirects all non-HTTPS traffic to HTTPS. The `.flycast` hostname does not have a valid certificate (it's the internal 6PN address), so the worker reaches the web app over plain HTTP. The middleware must skip the redirect when the request `Host` header matches `*.flycast`. Keep the apex→www redirect; only the protocol redirect is skipped. HSTS is also skipped on `.flycast` responses (HSTS without TLS is meaningless and would poison the browser cache if anything ever hit it over `https://`).

---

## Worker behavior

### Cycle

Each scheduled invocation:

1. Read the cursor from `/app/data/resend-sync/cursor.json` (default `""` if absent — the API treats empty as "from the beginning").
2. `GET /internal/v1/users/next?cursor=…` over `http://pickmyfruit.flycast` with the auth header.
3. If `user` is `null`: queue is **drained**; persist `nextCursor` (no-op if unchanged) and exit 0.
4. Otherwise: acquire a token from the rate-limit bucket (see [Rate limiting](#rate-limiting)), then upsert into Resend (Contacts view → POST/PATCH; ensure subscription to the Newsletter topic). Take **four tokens** per upsert (worst case: contact view + contact write + topics view + topics write).
5. On success: write `nextCursor` atomically to disk (write-temp + `rename`). **Loop** back to step 1 until drained, then exit 0. On stall (5xx/network/auth failure): exit 0 without advancing — the next scheduled run retries the same row.

### Why `LIMIT 1` in a tight loop instead of `LIMIT N`

- Each iteration commits its own cursor advance, so a crash mid-drain costs at most one redundant retry of the last row on next start.
- Backlog drainage is still O(N) round-trips, which is the Resend API cost ceiling anyway.
- Simpler reasoning about partial-failure: there is no "batch half succeeded" state.

### Cursor ordering tuple

The API orders by `(updated_at ASC, id ASC)` and encodes both in the opaque cursor. `updated_at` collisions are common during seeding, backfills, or any bulk operation; the `id` tiebreaker makes the cursor monotonic without ambiguity.

### Rate limiting

Resend's account-wide API limit is **5 calls/sec** (not shared with transactional email — verify against current Resend docs when implementing). Each upsert costs **2 calls** (view + create/update), so the effective ceiling is **2.5 upserts/sec**.

- **Token bucket sized in API calls, not upserts**, so the math survives if Resend ever ships a true single-call upsert.
- Default bucket: **4 tokens/sec, capacity 4**. Leaves headroom for the Future Work A reconciliation pass and for transactional sends from other parts of the app.
- Configurable via `RESEND_API_RATE_PER_SEC` (default `4`).
- **Honor `Retry-After`** on both `429` and `503` responses. When set, sleep at least that long before the next call regardless of bucket state.
- For `5xx` without `Retry-After`: exponential backoff with a 60s cap, jittered.

A fixed inter-row sleep is **explicitly rejected**: it punishes backfills (10k users × 3s = 8 hours) to defend against a burst problem the token bucket already solves.

### Failure semantics

| Failure                                           | Action                                                                                                                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal API **404 / 5xx / network error**        | **Stall**: do not advance the cursor. Sentry capture with `fingerprint = ['resend-sync', 'upstream-unavailable']`, `extra = { source: 'www', status }`.                                      |
| Resend **401 / 403** (bad/missing API key, scope) | **Stall**: do not advance. Sentry fingerprint `['resend-sync', 'resend-auth-failed']`. Treated separately from other 4xx so a revoked key cannot silently walk the cursor past every user.   |
| Resend **other 4xx** (e.g. invalid email format)  | **Advance** the cursor past the row; Sentry fingerprint `['resend-sync', 'resend-4xx']`, `extra = { userId, status }`. Treat as "this row will never succeed without a code or data change." |
| Resend **5xx / 429 / network / timeout**          | **Stall**: do not advance. Sentry fingerprint `['resend-sync', 'resend-unavailable']`, `extra = { status, retryAfter }`. Next scheduled run will retry the same row.                         |
| Worker process crash                              | Same as stall: the unadvanced cursor causes the row to be retried after restart.                                                                                                             |

We deliberately do **not** introduce a dead-letter list or `attempt_count` yet. If 4xx triage in Sentry shows recurring permanent failures (more than a handful per week), revisit (see [Future work](#future-work)).

### Updates that don't materially change Resend state

Better Auth bumps `user.updated_at` for changes that Resend does not care about (and may bump it for session/timestamp updates we add later). The worker will issue redundant idempotent upserts in those cases. This is acceptable: Resend upserts are cheap and idempotent.

**Critical exception — newsletter opt-out:** if/when the `user` schema gains a "subscribed to newsletter" flag, the API response must include it and the worker **must not** re-subscribe an opted-out user. The Resend call must reflect the current opt-in state (e.g. `unsubscribed: !user.subscribed`), not blindly upsert with `unsubscribed: false`. Mark this with a code comment at the Resend-mapping function and cover it with a unit test ("opted-out user is upserted with `unsubscribed: true`"). See [Future work](#future-work) for the larger subscription-management story.

### Schedule

`fly machine run . --schedule hourly` — the worker runs roughly once an hour, drains the queue, and exits. There is no in-process poll loop and no `RESEND_SYNC_POLL_MS`. If the steady-state delay (≤ ~1h until a profile change reaches Resend) ever becomes a product problem, tighten with a smaller schedule or move to a different scheduling primitive; do not reintroduce always-on polling.

### Signals

- **`SIGTERM` / `SIGINT`:** finish the current row (so we never have "Resend succeeded, cursor not yet committed"), then exit 0. Fly sends `SIGTERM` if the scheduled machine overruns its grace window.

---

## Cursor storage

The cursor lives in **`/app/data/resend-sync/cursor.json`** on the Fly volume.

```json
{ "cursor": "<opaque-string>" }
```

Why a JSON file rather than a SQLite table:

- The cursor is **internal state of the worker**, not application data. Backups happen at the volume level, so it's protected either way.
- A file removes any DB dependency from `apps/resend-sync`, keeping the package free of `libsql` / `better-sqlite3` and the schema-coupling-by-stealth that a shared table would invite.
- Fewer moving parts: no migration, no PRAGMAs, no second connection to coordinate.

**Atomicity**: writes go to `cursor.json.tmp` then `fs.rename` to `cursor.json` (atomic on POSIX). A crash mid-write leaves the previous cursor intact. Centralize this in a 10-line helper with a unit test.

**Scaling note**: this design assumes exactly one worker. Multiple workers + a JSON file = corruption risk. If we ever need to scale out, migrate the cursor to a shared store (Turso, Postgres, or a small SQLite via the same internal API). Tracked in [Future work F](#f-multi-worker-scale-out).

---

## Deployment

### Image

Single Docker image, multi-stage build:

- **`apps/www`** continues to build with Vite.
- **`apps/resend-sync`** builds with plain **`tsc`** to `apps/resend-sync/dist/`. Production runs `node apps/resend-sync/dist/main.js`. No esbuild, no Vite, no `import.meta.env` shimming. Dev ergonomics use `tsx` or `tsc --watch + node`; we only commit to `tsc` for the artifact that ships.
- Native binaries (`libsql`, `sharp`) remain in the web stage. The worker does not need them.

### Fly

- `fly.toml` declares only the `app` process group + the shared `data` mount; only `app` has `[http_service]`.
- The `resend_sync` machine is provisioned **once** with:

  ```sh
  fly machine run . \
    --schedule hourly \
    --restart no \
    --command "node apps/resend-sync/dist/main.js" \
    --region sjc \
    --volume data:/app/data
  ```

  Scheduled machines cannot be started manually after creation (the schedule begins on the first run). One scheduled machine is enough; the cursor file is not safe under concurrent writers.

- **Secrets** (worker): `RESEND_API_KEY`, `INTERNAL_API_SECRET` (and optional `INTERNAL_API_SECRET_PREVIOUS` during rotation), `SENTRY_DSN`.
- **Secrets** (web): `INTERNAL_API_SECRET` (and optional previous) — same values as worker.
- **Env** (worker): `INTERNAL_API_URL=http://pickmyfruit.flycast`, `RESEND_API_RATE_PER_SEC`.

### Local dev

Run web and worker side-by-side; both read from `.env.development`. Worker hits `http://localhost:5173/internal/v1/users/next` (no `.flycast` locally). Cursor file lives at `apps/www/data/resend-sync/cursor.json` or similar — pick one path and document it.

---

## SQLite PRAGMAs (web app only)

The worker does not open the SQLite file at all, so the historical concern about two processes racing on the DB goes away. The web app continues to use `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`.

---

## Observability

- `logger.info({ userId, cursor }, "resend-sync: upserted")` on success (worker side).
- `logger.info({ rows, durationMs }, "resend-sync: cycle drained")` once per non-empty cycle. Skip on empty cycles to avoid per-minute log spam.
- `Sentry.captureException` on failures with explicit `fingerprint` arrays per the [Failure semantics](#failure-semantics) table so grouping is stable even if error messages drift.
- `@sentry/node` in the worker, **shared Sentry DSN** with `environment` (or `release` tag) set to `resend-sync` so issues are easy to filter from web errors.
- Internal API requests: log method, path, status, durationMs. **Do not** log the `x-internal-auth` header.

OpenTelemetry traces are **not** in scope for v1. If we add them later, wrap one span per cycle and one child span per row + Resend call.

---

## Testing strategy

### Unit (worker)

- Cursor file round-trip: write → read → equal; atomic write survives simulated crash mid-write.
- Token bucket: refills correctly; takes N tokens per upsert; `Retry-After` overrides bucket state.
- Failure dispatch: 4xx advances + emits `resend-4xx` fingerprint; 5xx stalls + emits `resend-unavailable`; upstream 5xx stalls + emits `upstream-unavailable`.
- Resend mapping: opt-out (once that field exists) yields `unsubscribed: true`.

### Unit (web)

- `/internal/v1/users/next`: valid secret returns next user; invalid/missing secret returns 404 (not 401); previous-secret accepted during rotation.
- Auth header is stripped from request logs and Sentry breadcrumbs.
- TLS middleware: `.flycast` host skips the HTTPS redirect and HSTS header; all other hosts redirect as before.

### Contract test

A single test in `apps/www` that boots the route handler in-process, hits `/internal/v1/users/next` with a valid secret against a seeded fixture, and asserts the response matches a Zod schema. **Export that Zod schema from a small shared spot (or duplicate it in both packages with a "keep in sync" comment — at this scale, duplication is honest).** The worker's msw mock uses the same schema for fixture generation. No Pact, no broker.

### Integration

- Drive a Better Auth user create through its HTTP API against a test SQLite file → run one worker cycle (worker calls a test web server, msw stubs Resend) → assert the Resend stub received the upsert.
- Drive a user update → run one cycle → stub received the update.

### E2E

Not required for this slice.

### TDD discipline

Red-green double-loop is preferred but not mandated. The implementation surface is small enough that one or two integration tests plus the unit list above cover the risk.

---

## Sequence (commits)

| #   | Commit focus                                                                                                                                               | Testable output                                                                                        |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Revert PR-branch `resend_sync_state` table and seed; keep the `user(updated_at, id)` index.                                                                | Migration journal shows the table removed; index remains.                                              |
| 2   | `apps/resend-sync` package skeleton: `package.json`, `tsconfig`, `tsc` build, vitest (node env), entry stub.                                               | `pnpm --filter @pickmyfruit/resend-sync build` produces runnable JS; `pnpm test` runs the empty suite. |
| 3   | TLS middleware: skip HTTPS redirect + HSTS for `*.flycast` hosts; tests.                                                                                   | Unit test: `Host: pickmyfruit.flycast` request returns 200, not 307.                                   |
| 4   | `/internal/v1/users/next` route + Zod response schema + auth (timing-safe, two-secret) + 404-on-bad-secret + log/breadcrumb scrubbing + per-IP rate limit. | Unit + contract tests pass.                                                                            |
| 5   | Worker cursor file helper (atomic write).                                                                                                                  | Unit tests: round-trip, default, crash-mid-write recovery.                                             |
| 6   | Worker token bucket + Retry-After honoring.                                                                                                                | Unit tests: refill math, two-tokens-per-upsert, Retry-After override.                                  |
| 7   | Worker `processOneRow`: fetch from internal API, upsert via injected Resend client, advance cursor.                                                        | Unit tests cover success, Resend 4xx, Resend 5xx, upstream 5xx paths.                                  |
| 8   | Worker `runCycle` loop + `SIGTERM` handling + `AbortController` sleep.                                                                                     | Subprocess test: starts, drains a seeded server, sleeps, exits 0 on `SIGTERM`.                         |
| 9   | Resend client: real HTTP behind an interface, view + create/update mapping, opt-out guard.                                                                 | Contract test with `fetch` mock asserting URL/method/body for both calls.                              |
| 10  | Dockerfile multi-stage build for the worker (no `import.meta.env` defines); `fly.toml` process group.                                                      | `docker build` produces an image with both binaries; `fly deploy` smoke passes.                        |
| 11  | Local dev wiring: `pnpm dev` script that runs both, shared secret in `.env.development`.                                                                   | Manual smoke: create a user, cursor advances, Resend stub called.                                      |

---

## Risks and mitigations

| Risk                                                             | Mitigation                                                                                                                                                |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `updated_at` ties cause a row to be skipped                      | API orders by and encodes `(updated_at, id)` in the opaque cursor.                                                                                        |
| Worker stalls indefinitely on a poisoned row                     | Stall is **only** on 5xx/network; 4xx advances. Sentry surfaces both with stable fingerprints.                                                            |
| Internal API publicly reachable                                  | `.flycast` keeps traffic on Fly's private 6PN. Shared secret with timing-safe comparison and rotation pair. 404 on bad/missing secret. Per-IP rate limit. |
| Shared secret leaks via logs                                     | Scrubbers on request logger and Sentry breadcrumbs; tests assert the header never appears in either.                                                      |
| `user.updated_at` is bumped for fields Resend doesn't care about | Accepted cost: idempotent upserts. Comment at the mapping function explains.                                                                              |
| Newsletter opt-out gets clobbered on re-sync                     | API response includes opt-out flag; mapping reads it; unit test guards it.                                                                                |
| Worker killed between Resend success and cursor write            | Idempotent Resend upsert means the retry is harmless.                                                                                                     |
| Resend rate-limit triggered by a backfill                        | Token bucket sized in API calls (not upserts); honors `Retry-After`; backoff on 5xx.                                                                      |
| Cursor file corrupted by partial write                           | Atomic write-temp + rename; default to `""` cursor if the file is missing or unparseable (rewinds to start, idempotent).                                  |
| Web app down → worker stalls                                     | Treated identically to Resend 5xx; cursor does not advance; Sentry fingerprint `upstream-unavailable`.                                                    |

---

## Future work

### A. Nightly/weekly full-sync reconciliation (self-healing)

Run a scheduled full diff between `user` and Resend's audience. Recovers from any past bug, dropped event, or manual data fix; catches drift from edits made directly in the Resend dashboard. Implement as a second entry point in `apps/resend-sync` (e.g. invoked daily via in-process timer). Skip until we have evidence of drift in production.

### B. Two-way subscription sync

Today, opt-out lives only in Resend. To respect opt-out across the app:

- Add a `subscribed` column on `user`.
- Expose subscription state in profile UI.
- On Resend webhook (`contact.unsubscribed`), update the local row (a new endpoint on `apps/www`).
- The cursor worker continues to be the **outbound** half; the webhook is the **inbound** half.

### C. Dead-letter list

If Sentry shows recurring 4xx failures for specific users, add a `dead_letter` array in the cursor file (or a separate `dead-letter.json`) so operators can re-attempt after fixing the data without rewinding the cursor for the whole table.

### D. Shared schema package

If a second worker emerges that genuinely benefits from in-process schema access (vs. the internal API), extract `packages/db`. The internal HTTP API is the default; this is the escape hatch.

### E. General-purpose job queue / durable workflows

Tracked: [#123](https://github.com/jamesarosen/PickMyFruit/issues/123), [#126](https://github.com/jamesarosen/PickMyFruit/issues/126). Out of scope until we have multiple async integrations with stricter latency or fan-out requirements.

### F. Multi-worker scale-out

The JSON cursor file assumes one writer. If we need multiple workers (sharded by hash of user id, say), migrate the cursor to a shared store — Turso, Postgres, or a small dedicated SQLite served through the same internal API. At that point, also revisit the shared-secret auth model.

### G. GDPR right-to-erasure for Resend contacts

Today, nothing removes a Resend contact when a Pick My Fruit account is deleted. Account deletion isn't a user-facing feature yet, but when it lands, the deletion path must also call `DELETE /contacts/{id}` (or enqueue a "tombstone" cursor row the worker can act on). Without this, deleted users remain in Resend audiences indefinitely, which violates GDPR Article 17. Open issue and link here when filed.

### H. Marketing consent at signup (**HIGH-PRIORITY — blocks enabling sync in prod**)

The current upsert defaults new contacts to `unsubscribed: false`. Pick My Fruit has no signup-time newsletter checkbox; users sign up to share fruit, not to opt into marketing. Under GDPR/CAN-SPAM, an implicit opt-in is non-compliant. Before this worker is enabled against the production Resend audience:

1. Add a `marketing_opt_in` column on `user` (default `false`).
2. Add an unchecked "Send me the occasional newsletter" checkbox to the signup flow (and a corresponding toggle in the profile UI — see Future Work I).
3. Expose `marketing_opt_in` in the `/internal/v1/users/next` response and have the worker filter on it (or pass `unsubscribed: !opt_in` to Resend).

Tracked separately; do not deploy the worker to production until this lands.

### I. Per-topic opt-in in the profile UI

Today the worker resolves a single topic by exact name (`"Newsletter"`). Once a profile-level subscription UI exists (paired with Future Work H), the user can see all Resend topics and choose per-topic subscription, and the worker can drive subscriptions from the local state rather than relying on a hardcoded topic name. This obviates the operational risk of someone renaming the topic in the Resend dashboard.

---

## References

- Better Auth — [Database hooks](https://better-auth.com/docs/concepts/database#database-hooks) (not used by this design, but relevant if Future Work B adds inbound webhooks)
- Fly.io — [Private networking & `.flycast`](https://fly.io/docs/networking/flycast/)
- Fly.io — [Run multiple processes](https://fly.io/docs/app-guides/multiple-processes/)
- Fly.io — [Task scheduling blueprint](https://fly.io/docs/blueprints/task-scheduling/)
- Resend — [Rate limits](https://resend.com/docs/api-reference/introduction#rate-limit) (verify current values when implementing)
- Project conventions — `AGENTS.md`, `CLAUDE.md` (migrations, logging, Sentry)
- Superseded predecessor — `docs/0006-resend-sync-outbox.md` on PR #239
