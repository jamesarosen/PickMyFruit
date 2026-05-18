# Resend contact sync via cron-style cursor worker

## Summary

Keep Pick My Fruit's **user lifecycle** (create, profile update) in sync with **Resend** (Contacts + Topics) using a **small long-lived worker** that runs as a `child_process` of the `apps/www` web server inside a single Fly machine. The worker wakes on `RESEND_SYNC_POLL_MS`, asks the web app over an internal HTTP API for the next user changed since the last successful sync, calls Resend, advances a cursor stored in a small file on the Fly volume, and sleeps. There is **no jobs table**, **no outbox**, and **no producer-side enqueue discipline** — the `user` table is itself the queue.

Email **templating** (moving magic-link and inquiry bodies into Resend Templates) is **orthogonal**; this doc covers **contact / audience sync** only.

**Related:**

- GitHub issue "Resend User Sync" (#237).
- Supersedes the outbox proposal in PR #239 (originally `docs/0006-resend-sync-outbox.md` on `cursor/resend-sync-outbox-plan-1755`). The outbox design and a partial implementation existed on an earlier state of this branch that has since been rewritten; see [Revision history](#revision-history) for the journey.

---

## Revision history

This design evolved through five iterations on the same PR (#239). Each pivot is documented here because the failure modes that pushed us off each version are load-bearing context for the current shape; "why we didn't" is often more useful than "why we did."

### v1 — Transactional outbox (design only)

A `resend_sync_outbox` table in SQLite, written by Better Auth's `databaseHooks` on user create/update; a long-lived `resend-sync` consumer on the **same Fly machine** polled the table, called Resend, and marked rows `processed_at`. An optional HTTP "best-effort wake" ping from `app` → `resend-sync` was sketched to reduce poll latency, but the outbox table remained the authoritative source. Two long-lived processes on one Fly machine sharing the SQLite file. Original design lived at `docs/0006-resend-sync-outbox.md` — see PR #239's history for the full text.

**Why rejected:** Two long-lived processes in one Fly container is operationally awkward — "the machine should die if `www` dies, but `resend-sync` should be restartable" doesn't map cleanly to any of the off-the-shelf supervisors (foreman/goreman/node-foreman/honcho/overmind/hivemind), and they all prefix stdout/stderr by default, defeating our structured logs. We also didn't want a separate outbox table when the `user` table is already the queue ordered by `(updated_at, id)`. Per this branch's git history, v1 lived only as a design doc; any partial implementation that existed earlier was rewritten away before `6d01efb` landed.

### v2 — In-`apps/www` worker, two always-on machines

Worker code lived inside `apps/www/resend-sync.server.ts`. The two Fly processes were declared via `[processes]` and ran as separate always-on Machines (Fly's default per group), communicating over the private 6PN network. The build used `esbuild --define:import.meta.env.*` so the worker bundle didn't try to do Vite-style env replacement at build time. Reference: commits `32b7a4b` (`resend_sync_state` table) through `1df0346` (dev script).

**Why rejected:** Sharing the worker's source tree with `apps/www` forced a 27-line `--define:import.meta.env.VITE_*` block in the Dockerfile, a vitest project carve-out, and libsql resolution workarounds for a process that wants none of those things. The worker's build was perpetually working against the grain of Vite.

### v3 — Two packages, two always-on machines

Worker extracted into its own workspace package `apps/resend-sync` with a plain `tsc` build, its own Sentry init (`@sentry/node` reading `SENTRY_DSN`), and zero DB dependencies. Communication was over `http://pickmyfruit.flycast` with `INTERNAL_API_SECRET` in `x-internal-auth`. Cursor moved off SQLite onto an atomic JSON file on the Fly volume. Reference: commits `a863204` (doc rewrite) and `a8c9cf3` through `b9aea4f`.

**Why rejected:** Two always-on Fly Machines for a job that's idle 99% of the time wasted both money and observability surface area. A reviewer flagged this as the wrong parallelism model.

### v4 — One always-on machine + one scheduled machine

`apps/www` kept its always-on Machine; `apps/resend-sync` moved to a Fly **scheduled machine** (`fly machine run . --schedule hourly`), drain-once-and-exit. Reference: commit `babf5eb`.

**Why rejected:** Fly's minimum schedule granularity is hourly, so the steady-state lag from a profile change to its Resend reflection grew to ~1h. The scheduled machine also reintroduced a per-run cold start (Node boot + `findNewsletterTopicId` round-trip) on every invocation, and split the worker's logs into a separate stream from the web app's.

### v5 — One machine, one container, `www` spawns the worker as a child process (current)

`apps/www`'s `start.ts` calls `spawnResendSyncWorkerIfEnabled()` at boot, which spawns `apps/resend-sync` as a Node `child_process` when `RESEND_SYNC_WORKER_ENABLED=true`. Long-lived poll loop returns; cold start happens once per machine restart instead of once per cycle; logs interleave naturally. Communication stays over `pickmyfruit.flycast` (not loopback) so the security model and the graduation path are unchanged.

**Crash policy:** if the worker child crashes, www's supervisor logs and Sentry-captures the non-zero exit but does **not** auto-restart. The container restart cycle (deploy, health-check failure, OOM) brings the worker back. Acceptable because the cursor is durable and recurring crashes will surface as a stable Sentry fingerprint.

### Graduation paths (if v5 stops fitting)

When this shape outgrows itself, the options ranked by smallest disturbance:

- **Long-lived sub-processes for additional workers** on the same machine — pattern repeats; bin/start logic stays single-threaded.
- **A general-purpose `workers` machine** — group multiple background workers onto one shared, always-on Fly machine separate from `www`. Reverts to the v3 topology but with multiple jobs justifying the cost.
- **[s6-overlay](https://github.com/just-containers/s6-overlay)** — real per-process supervision with auto-restart, if the "container restart catches it" policy stops being good enough.
- **A Node process manager like [pm2](https://www.npmjs.com/package/pm2)** — same idea, different toolchain.
- **Per-process credential scoping via a keystore** (1Password, Doppler) — the natural next step after we have multiple workers reading different subsets of the env.

---

## Goals

1. When a **user record is created** or **updated**, eventually upsert the contact in Resend. The Newsletter topic uses Resend's default opt-in on contact create, so this design does not explicitly manage topic subscription.
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

### One Fly machine, one container, two Node processes, two packages

| Process       | Package            | Role                                                                                                                                                               |
| ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `app` (PID 1) | `apps/www`         | Serves public HTTP; Better Auth writes `user` rows as usual. Adds a small `/internal/v1/*` API used only by the worker. Hosts the only `[processes]` group on Fly. |
| worker child  | `apps/resend-sync` | Long-lived poll loop. Spawned at boot by `apps/www/src/lib/spawn-resend-sync.server.ts` as a Node child process when `RESEND_SYNC_WORKER_ENABLED=true`.            |

A single Fly machine runs both. The web server is the foreground process; the worker is its `child_process.spawn`'d sibling. The worker hits the web server over `http://pickmyfruit.flycast` (not loopback) so the security model is identical to a future multi-machine split — Fly's edge signs `Fly-Src` for the internal call and the TLS middleware verifies it against `/.fly/fly-src.pub` (see `apps/www/src/lib/is-fly-internal-request.server.ts`).

**Why one container instead of two Fly machines?** Earlier revisions of this doc tried two shapes: an always-on `[processes] resend_sync` group, and a Fly scheduled machine (`fly machine run --schedule hourly`). The always-on process group was an always-on idle VM — wrong cost profile. The scheduled machine fixed the cost but added an always-on machine of its own (per Fly's process model, each `[processes]` entry creates a machine; scheduled machines avoid that but introduce a per-run cold-start and a separate observability stream for what is one logical pipeline). Going back to a **single container with a child process** is the cheapest shape (one VM, one log stream, no scheduler) while preserving graduation: removing the spawn from `start.ts` and adding a `[processes] resend_sync` or scheduled-machine config restores the prior topology in minutes.

**Worker crash policy: rely on container restart.** If the worker child crashes, www's supervisor (`attachWorkerSupervision`) logs and Sentry-captures the non-zero exit, but does **not** auto-restart. The next container cycle (deploy, Fly health check failure, OOM, manual restart) brings the worker back. Acceptable because (a) the cursor is durable, so missed cycles only delay sync — they don't lose data, and (b) recurring crashes will surface as a stable Sentry fingerprint (`['resend-sync', 'worker-child-crashed']`). If that signal turns noisy, graduate to a real supervisor (s6-overlay) or split the worker back out to its own machine.

**Kill switch.** `RESEND_SYNC_WORKER_ENABLED` is a runtime gate. Default `false` in `apps/www/.env.development`; default `true` in `fly.toml`. Disable in prod without redeploying via `fly secrets set RESEND_SYNC_WORKER_ENABLED=false`. The gate is enforced twice — once in www's spawn helper (so no child process is even started) and once at the worker's own startup (defence-in-depth against direct invocation).

**Why a separate package, not a second entry point in `apps/www`?** Keeping the worker inside `apps/www` forced a 27-line `--define:import.meta.env.VITE_*` block in the Dockerfile to fake out Vite's build-time replacement, plus a vitest project carve-out and libsql resolution workarounds for a process that wants none of those things. Each future worker would inherit and amplify that tax. The extracted package is a plain Node bundle with `process.env`, `@sentry/node`, and a tsc build — no Vite, no jsdom, no `import.meta.env` shimming. The same artefact will deploy as a separate machine the day we want to.

**Why not import the web app's DB client directly?** Cross-app imports break the `apps depend on packages` convention, couple the worker's build to web-only tooling (TanStack Start's import-protection, Vite paths), and recreate the toolchain mixing the extraction was meant to end. The two options worth considering are a `packages/db` workspace and an internal HTTP API. We chose the **HTTP API** for forward flexibility and for the security symmetry above (Fly-Src verification works identically whether the worker is local or remote).

**Why HTTP over flycast for a same-container call?** Loopback (`http://localhost:3000`) would skip Fly's proxy hop and shave a few ms, but it would tightly couple the worker to "same container" and break the Fly-Src verification path. We pay the proxy hop to keep the security and topology contract intact.

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

- **200** `{ "user": { "id", "email", "name" } | null, "nextCursor": "<opaque-string>" }`. When `user` is `null`, the queue is drained; the worker still persists `nextCursor` (it equals the request cursor) and sleeps `RESEND_SYNC_POLL_MS` before the next cycle.
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

### TLS-redirect carve-out (Fly-Src verified)

`apps/www/src/middleware/tls.ts` redirects all non-HTTPS traffic to HTTPS, but the `.flycast` hostname has no TLS certificate (it's the internal 6PN address), so the worker reaches the web app over plain HTTP. To skip the redirect for internal traffic **without** trusting a spoofable host header, the middleware verifies Fly's `Fly-Src` / `Fly-Src-Signature` pair using the Ed25519 public key Fly mounts at `/.fly/fly-src.pub`:

1. Parse `Fly-Src` (`instance=…;app=…;org=…;ts=…`).
2. Require `app === FLY_APP_NAME` and `ts` within the replay window (30 s).
3. Verify the base64 Ed25519 signature in `Fly-Src-Signature` over the raw `Fly-Src` bytes.

Only when all three pass does the middleware treat the request as internal and skip both the HTTPS redirect and HSTS. Public traffic never carries a verifiable `Fly-Src`, so it cannot opt out of the redirect by spoofing `x-forwarded-host: *.flycast` (the previous heuristic). The apex→www redirect still fires regardless.

Implementation lives in `apps/www/src/lib/is-fly-internal-request.server.ts`; tests use injectable `readFile` + a generated Ed25519 keypair so the verification logic is exercised without depending on the real `/.fly/fly-src.pub` file.

@see https://community.fly.io/t/detect-public-vs-private-connection/20971
@see https://community.fly.io/t/fly-src-authenticating-http-requests-between-fly-apps/20566

---

## Worker behavior

### Cycle

The worker runs a long-lived poll loop. Each cycle:

1. Read the cursor from `/app/data/resend-sync/cursor.json` (default `""` if absent — the API treats empty as "from the beginning").
2. `GET /internal/v1/users/next?cursor=…` over `http://pickmyfruit.flycast` with the auth header.
3. If `user` is `null`: queue is **drained**; persist `nextCursor` (no-op if unchanged) and sleep `RESEND_SYNC_POLL_MS` before the next cycle.
4. Otherwise: acquire tokens from the rate-limit bucket (see [Rate limiting](#rate-limiting)), then upsert into Resend (Contacts view → POST/PATCH). Take **two tokens** per upsert (contact view + contact write).
5. On success: write `nextCursor` atomically to disk (write-temp + `rename`). **Loop** back to step 1 until drained, then sleep. On stall (5xx/network/auth failure): break the inner loop, sleep, and retry the same row on the next cycle.

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
| Resend **5xx / 429 / network / timeout**          | **Stall**: do not advance. Sentry fingerprint `['resend-sync', 'resend-unavailable']`, `extra = { status, retryAfter }`. Next poll cycle retries the same row.                               |
| Worker process crash                              | Same as stall: the unadvanced cursor causes the row to be retried after restart.                                                                                                             |

We deliberately do **not** introduce a dead-letter list or `attempt_count` yet. If 4xx triage in Sentry shows recurring permanent failures (more than a handful per week), revisit (see [Future work](#future-work)).

### Updates that don't materially change Resend state

Better Auth bumps `user.updated_at` for changes that Resend does not care about (and may bump it for session/timestamp updates we add later). The worker will issue redundant idempotent upserts in those cases. This is acceptable: Resend upserts are cheap and idempotent.

**Critical exception — newsletter opt-out:** if/when the `user` schema gains a "subscribed to newsletter" flag, the API response must include it and the worker **must not** re-subscribe an opted-out user. The Resend call must reflect the current opt-in state (e.g. `unsubscribed: !user.subscribed`), not blindly upsert with `unsubscribed: false`. Mark this with a code comment at the Resend-mapping function and cover it with a unit test ("opted-out user is upserted with `unsubscribed: true`"). See [Future work](#future-work) for the larger subscription-management story.

### Polling interval

`RESEND_SYNC_POLL_MS`, default `60_000` (1 minute) in prod, `2_000` in dev. The cycle exits early when drained, so the steady-state cost is one indexed `SELECT` per minute against a small table. The poll loop is long-lived inside the worker child; one Node boot per container lifetime, not per cycle.

### Signals

- **`SIGTERM` / `SIGINT`:** finish the current row (so we never have "Resend succeeded, cursor not yet committed"), then exit 0. An `AbortController` is shared with the inter-cycle sleep so a signal during sleep wakes the loop immediately.
- The www parent forwards its own `SIGTERM`/`SIGINT` to the worker child (see `attachWorkerSupervision`), so container shutdown propagates cleanly.

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

- `fly.toml` declares a single `app` process group + the shared `data` mount; only `app` has `[http_service]`. No second process group, no scheduled machine.
- At boot, `apps/www/src/start.ts` calls `spawnResendSyncWorkerIfEnabled()` (in `apps/www/src/lib/spawn-resend-sync.server.ts`). When `RESEND_SYNC_WORKER_ENABLED=true`, that helper `child_process.spawn`s `apps/resend-sync/dist/main.js` with stdio inherited so logs interleave naturally. The supervisor forwards `SIGTERM`/`SIGINT` and Sentry-captures non-zero child exits.
- **Secrets** (one set, shared by both processes since they share env): `RESEND_API_KEY`, `INTERNAL_API_SECRET` (and optional `INTERNAL_API_SECRET_PREVIOUS` during rotation), `SENTRY_DSN`.
- **Env**: `INTERNAL_API_URL=http://pickmyfruit.flycast`, `RESEND_SYNC_POLL_MS`, `RESEND_SYNC_WORKER_ENABLED=true`, `RESEND_API_RATE_PER_SEC`, `RESEND_API_BUCKET_CAPACITY`, `RESEND_SYNC_CURSOR_PATH`.
- **Runtime kill switch**: `fly secrets set RESEND_SYNC_WORKER_ENABLED=false` disables the worker without a code change. The next container restart skips the spawn.

### Local dev

`apps/resend-sync` has **no** dev script, no `.env.development`, and no `dotenvx` — it's a library + entrypoint that only runs as a child of www. The worker has exactly one launch path in every environment: www's spawn helper. Devs who would otherwise be tempted to "just run the worker" against localhost can't, because the env vars the worker needs live in `apps/www/.env.development`.

Root `pnpm dev` runs only `apps/www`'s vite. At boot, www's `start.ts` calls the spawn helper:

- With the default `RESEND_SYNC_WORKER_ENABLED=false` in `apps/www/.env.development`, the helper logs "worker disabled" and skips the spawn. www runs alone on `:5173`.
- A dev who wants to exercise the loop adds `RESEND_SYNC_WORKER_ENABLED=true` + `RESEND_API_KEY=…` to `apps/www/.env.development.local`. The spawn fires; the worker child inherits all needed env (including `RESEND_SYNC_CURSOR_PATH=data/resend-sync/cursor.json` which resolves relative to www's CWD = `apps/www/data/resend-sync/cursor.json`, next to `development.db`).

Iterating on worker code requires restarting www to reload the child. Hot-reload is listed as Future Work; in practice this trade-off is fine because worker changes are infrequent.

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
- TLS middleware: verified `Fly-Src` skips the HTTPS redirect and HSTS header; all other hosts redirect as before. Forged `x-forwarded-host: *.flycast` does **not** bypass the redirect.

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

| #   | Commit focus                                                                                                                                                                  | Testable output                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1   | Revert PR-branch `resend_sync_state` table and seed; keep the `user(updated_at, id)` index.                                                                                   | Migration journal shows the table removed; index remains.                                              |
| 2   | `apps/resend-sync` package skeleton: `package.json`, `tsconfig`, `tsc` build, vitest (node env), entry stub.                                                                  | `pnpm --filter @pickmyfruit/resend-sync build` produces runnable JS; `pnpm test` runs the empty suite. |
| 3   | TLS middleware: skip HTTPS redirect + HSTS when `Fly-Src` is present and Ed25519-verified against `/.fly/fly-src.pub`; tests cover bad sig, wrong app, stale ts, missing key. | Unit test: verified Fly-Src returns 200, unsigned/forged request returns 307.                          |
| 4   | `/internal/v1/users/next` route + Zod response schema + auth (timing-safe, two-secret) + 404-on-bad-secret + log/breadcrumb scrubbing + per-IP rate limit.                    | Unit + contract tests pass.                                                                            |
| 5   | Worker cursor file helper (atomic write).                                                                                                                                     | Unit tests: round-trip, default, crash-mid-write recovery.                                             |
| 6   | Worker token bucket + Retry-After honoring.                                                                                                                                   | Unit tests: refill math, two-tokens-per-upsert, Retry-After override.                                  |
| 7   | Worker `processOneRow`: fetch from internal API, upsert via injected Resend client, advance cursor.                                                                           | Unit tests cover success, Resend 4xx, Resend 5xx, upstream 5xx paths.                                  |
| 8   | Worker `runCycle` loop + `SIGTERM` handling + `AbortController` sleep.                                                                                                        | Subprocess test: starts, drains a seeded server, sleeps, exits 0 on `SIGTERM`.                         |
| 9   | Resend client: real HTTP behind an interface, view + create/update mapping, opt-out guard.                                                                                    | Contract test with `fetch` mock asserting URL/method/body for both calls.                              |
| 10  | Dockerfile multi-stage build for the worker (no `import.meta.env` defines); `fly.toml` process group.                                                                         | `docker build` produces an image with both binaries; `fly deploy` smoke passes.                        |
| 11  | Local dev wiring: `pnpm dev` script that runs both, shared secret in `.env.development`.                                                                                      | Manual smoke: create a user, cursor advances, Resend stub called.                                      |

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

Today the worker relies on Resend's default opt-in on contact create — the Newsletter topic is the only topic that exists, and a fresh contact is automatically subscribed. Once a profile-level subscription UI exists (paired with Future Work H) and we have more than one topic to surface, the user should be able to see all Resend topics and choose per-topic subscription, and the worker should drive subscriptions from the local state rather than relying on Resend's create-time defaults.

### J. Hot-reload of the worker child during dev

Editing `apps/resend-sync` source currently requires restarting www to pick up the new worker bundle. This is acceptable because worker changes are infrequent. A nice-to-have: have `apps/resend-sync`'s `tsc --watch` write to `dist/`, and have www's spawn helper watch the bundle for changes and re-spawn the child (e.g. via a SIGHUP listener on the parent, or an fs.watch on the dist file). Strictly DX; production semantics are unchanged.

---

## References

- Better Auth — [Database hooks](https://better-auth.com/docs/concepts/database#database-hooks) (not used by this design, but relevant if Future Work B adds inbound webhooks)
- Fly.io — [Private networking & `.flycast`](https://fly.io/docs/networking/flycast/)
- Fly.io — [Run multiple processes](https://fly.io/docs/app-guides/multiple-processes/)
- Fly.io — [Task scheduling blueprint](https://fly.io/docs/blueprints/task-scheduling/)
- Resend — [Rate limits](https://resend.com/docs/api-reference/introduction#rate-limit) (verify current values when implementing)
- Project conventions — `AGENTS.md`, `CLAUDE.md` (migrations, logging, Sentry)
- Superseded predecessor — `docs/0006-resend-sync-outbox.md` on PR #239
