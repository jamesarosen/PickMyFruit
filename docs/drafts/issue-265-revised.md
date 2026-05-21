# Notifications: implementation plan (post-#260 jobs framework)

**Status:** Planning issue — supersedes delivery mechanics in draft PRs [#210](https://github.com/jamesarosen/PickMyFruit/pull/210) and [#212](https://github.com/jamesarosen/PickMyFruit/pull/212). Reuses domain logic; revises throttle semantics and email shape per review below.

**Prerequisites:** [#260](https://github.com/jamesarosen/PickMyFruit/issues/260) merged (`jobs` table, `apps/resend-worker`, internal jobs API, inquiry on outbox). [#239](https://github.com/jamesarosen/PickMyFruit/pull/239) and [#264](https://github.com/jamesarosen/PickMyFruit/pull/264) are on `main`.

**Changelog (review pass):** `immediately` → **`daily`**; both periods are **digest** emails; pinned **`windowStart`**; **`dedupe_key`** for enqueue/Resend idempotency (keeps **UUIDv7** `jobs.id` per #260); terminal-failure handling; RFC 8058 **POST** unsubscribe; **`HMAC_SECRET_PREVIOUS`**; always-enqueue + worker branches on `EMAIL_PROVIDER`; env rename in **separate chore PR**.

---

## 1. Situation analysis

### What the notification PRs built

| PR | Branch | Scope | Architecture |
| --- | --- | --- | --- |
| [#210](https://github.com/jamesarosen/PickMyFruit/pull/210) | `notifications-foundation` | `docs/0005-notifications.md` + data + runner + email + cron (~1.4k LOC) | `supercronic` → `POST /api/cron/notify` → inline Resend in `www` |
| [#212](https://github.com/jamesarosen/PickMyFruit/pull/212) | `cursor/notifications-create-list-flow-38d8` | #210 + create/list UI (+617 LOC) | No edit/unsubscribe routes |

Both share five foundation commits; neither rebases cleanly onto `main`.

**Worth keeping:** H3 matcher, subscription schema, HMAC unsubscribe, digest-style weekly copy from #210's product intent, UI patterns from #212.

**Drop from PRs:** `immediately` throttle, hourly cron, per-listing send loop, `CRON_SECRET`, inline Resend.

### What landed on `main`

- **#239:** `resend-sync` child process, `/internal/v1/users/next`, cursor file (`docs/0007-resend-sync-cron.md`).
- **#264:** Self-contained worker deploy bundle + `RESEND_SYNC_WORKER_PATH`.
- Migration **`0007`** is `add_resend_sync` — notifications use **`0008_…`**.

### #260 (assumed landed)

Generic `jobs` + `resend-email` queue; **`jobs.id` = UUIDv7** = default Resend `Idempotency-Key` for inquiry/newsletter jobs. User-sync cursor **unchanged**.

### Throttle redesign: `daily` + `weekly` (not `immediately`)

| Before (PR 210) | After (this plan) |
| --- | --- |
| `immediately` ≈ hourly cron | **`daily`** — one digest per subscription per UTC calendar day |
| `weekly` digest (intended) + hourly per-listing ambiguity | **`weekly`** — one digest per subscription per ISO week |
| ~24 sweeps/day for "immediate" | **≤1 sweep/day** per period when due |
| Misleading UI ("Immediately") | Honest labels: **Daily** / **Weekly** |

**Product SLA (explicit):** A new listing may appear in a **daily** subscriber's inbox up to **~24 hours** later (next UTC-day window). That is the published behavior — not "instant." If sub-day latency becomes a requirement, track a **follow-up issue** (e.g. sweep on `listing` insert for daily subscribers only); it is **not** in v1.

**Benefits bundled into this choice:**

- One payload shape, one render path, one template test suite for both periods.
- `windowStart` is calendar-aligned (defined below) — no ad-hoc hourly semantics.
- Sweep poll can be **5–15 min** (`NOTIFICATION_SWEEP_POLL_MS`); no 60s poll fighting user-sync for tick budget.
- "Never matches" subscriptions scanned **~24× less** — more headroom before the 500-listing in-memory scan must be SQL-prefiltered.
- Empty windows: sweep **skips send but advances `last_notified_at`** so due-query does not re-scan forever (cheap at daily granularity).
- Deliverability: ≤1 email/subscriber/day (daily) vs up to 24/hour.

### Target architecture

```mermaid
flowchart LR
  UI[/notifications UI]
  UI --> DB[(SQLite)]
  W[resend-worker]
  W -->|POST sweep daily/weekly when due| SW[/internal/v1/notifications/sweep]
  SW --> DB
  SW -->|enqueue digest job| JOBS[(jobs)]
  W -->|claim resend-email| JAPI[/internal/v1/jobs/*]
  JAPI --> DB
  W -->|send; Idempotency-Key=dedupe_key| R[Resend]
  U[Unsubscribe] -->|GET or POST| UNS[/api/notifications/:id/unsubscribe]
```

| Concern | PR 210/212 | Target |
| --- | --- | --- |
| Scheduler | `supercronic` | Worker poll **5–15 min**; clock decides if daily/weekly period is due |
| Email | Inline Resend | `resend-email` job; worker sends |
| Idempotency | `notify-{sub}-{period}-{window}` string | **`dedupe_key`** column + Resend header (see §5); **`jobs.id` stays UUIDv7** |

---

## 2. Adversary review of the analysis (resolved)

| Finding | Resolution |
| --- | --- |
| Matching in jobs table? | No — sweep in `www`, jobs hold rendered digest payloads only. |
| `last_notified_at` on enqueue? | No — on **complete**; also on **terminal fail** and **empty match** (see §5). |
| 500-listing scan | MVP OK; **Future Work** in S1/S2 commit messages: H3/SQL prefilter issue. |
| Hourly lag footnote | Replaced by explicit **daily SLA** + optional follow-up issue for listing-triggered sweep. |
| UUIDv5 vs UUIDv7 | **Do not replace UUIDv7.** Add **`dedupe_key`** for logical window dedupe + Resend idempotency (§5). |
| GET-only unsubscribe | **POST** + `List-Unsubscribe-Post` required (§5). |

---

## 3. Action plan

0. **#260** on `main`.
1. **Chore PR (before S2):** `RESEND_SYNC_WORKER_ENABLED` → `BACKGROUND_WORKER_ENABLED` — Fly secret + deploy synchronized; **independently revertible** from notifications.
2. **S1:** Schema (`daily` \| `weekly`), matcher, HMAC (+ `HMAC_SECRET_PREVIOUS`), queries, unit tests.
3. **S2:** Sweep API, `listing-alert-digest` jobs, worker sweep loop, complete/fail hooks, integration tests.
4. **S3:** UI (Daily/Weekly picker), geocoding, E2E (job row always exists).
5. **S4:** Unsubscribe GET+POST, RFC 8058 headers, disabled-subscription UI, E2E.

---

## 4. Adversary review of the action plan (resolved)

| Finding | Resolution |
| --- | --- |
| Sweep starves user-sync | **Mitigated by daily/weekly:** sweep runs at most once per period per day/week when due; 5–15 min poll only checks clocks. Sequential tick: user-sync → optional sweep(s) → drain `resend-email` within **token-bucket budget** (same as #239/#260; honors Resend [rate limits](https://resend.com/docs/api-reference/rate-limit) + `Retry-After`). |
| Duplicate sends same window | **`dedupe_key` unique** among active jobs + Resend `Idempotency-Key: dedupe_key`. |
| Stuck subscription on permanent Resend failure | **Terminal `fail`:** `markSubscriptionNotified` + increment `consecutive_failures`; **≥3** → `enabled = 0` + UI badge (§5). |
| `windowStart` undefined | **Pinned** (§5). |
| Weekly = 50 emails | **Digest only** for both periods — `listingIds[]` in one payload. |
| Clock-only due loses state on restart | **Accepted MVP:** restart may run a due sweep early; `dedupe_key` makes re-enqueue safe. **Follow-up issue:** durable `last_sweep_at` file (like resend cursor). Document in `0008`. |
| `EMAIL_PROVIDER=console` vs tests | **Always enqueue**; worker send path branches (log, no HTTP) — same as uniform job lifecycle for tests. |

---

## 5. Final implementation plan

### `windowStart` (canonical — used in due-query, dedupe_key, payload)

All times **UTC**.

| Period | `windowStartEpochSec` | Meaning |
| --- | --- | --- |
| `daily` | `floor(now_ms / 86400000) * 86400` | Start of current UTC calendar day |
| `weekly` | Epoch sec of **Monday 00:00:00 UTC** for the week containing `now` | ISO week aligned to Monday (not locale-dependent) |

Implement once in `apps/www/src/lib/notification-window.server.ts` with unit tests and **frozen fake timers** in tests (pick a UTC date, freeze, assert).

**Due subscription:** `last_notified_at IS NULL OR last_notified_at < windowStartEpochSec` for that period's current window.

### Schema (`0008_add_notification_subscriptions.sql`)

```sql
-- throttle_period CHECK ('daily', 'weekly')  -- NOT 'immediately'
enabled INTEGER NOT NULL DEFAULT 1,
consecutive_failures INTEGER NOT NULL DEFAULT 0,
-- plus: center_h3, resolution, ring_size, place_name, produce_types,
--       last_notified_at, created_at, updated_at, deleted_at, user_id, label
```

- Index: `(throttle_period, last_notified_at) WHERE deleted_at IS NULL AND enabled = 1`.
- **Limit trigger:** `BEFORE INSERT` → `RAISE(ABORT, 'subscription_limit_exceeded')` when `COUNT(*) >= 10` for `user_id` **and `deleted_at IS NULL` only** (soft-deletes do not consume quota).

**Env:** `HMAC_SECRET`, `HMAC_SECRET_PREVIOUS` (optional, verify accepts either — mirror `INTERNAL_API_SECRET` / `_PREVIOUS` in `env.server.ts`), `NOMINATIM_USER_AGENT`.

### Jobs: UUIDv7 `id` + `dedupe_key` (does not replace #260)

Per #260, **`jobs.id` is always UUIDv7** at insert time.

Listing-alert digests add:

```sql
dedupe_key TEXT NOT NULL  -- e.g. listing-alert:42:daily:1716163200
```

Partial unique index (or enqueue-time check): one **incomplete** row per `dedupe_key`:

```sql
CREATE UNIQUE INDEX jobs_dedupe_active_idx ON jobs(dedupe_key)
  WHERE completed_at IS NULL AND failed_at IS NULL;
```

- **Enqueue:** if active row exists for `dedupe_key` → skip (idempotent re-sweep).
- **Resend:** `Idempotency-Key: dedupe_key` (stable across retries for the same logical digest). **`job.id` (UUIDv7) is correlation only** for this job type — document as intentional exception to the default inquiry rule in `docs/0008-notifications.md`.

**`dedupe_key` format:**

```
listing-alert:{subscriptionId}:{throttlePeriod}:{windowStartEpochSec}
```

### `resend-email` payload — single digest variant

```ts
z.object({
  type: z.literal('listing-alert-digest'),
  to: z.string().email(),
  subject: z.string(),
  html: z.string(),
  subscriptionId: z.number(),
  throttlePeriod: z.enum(['daily', 'weekly']),
  windowStartEpochSec: z.number(),
  listingIds: z.array(z.number()), // matched listings this window
})
```

- Sweep renders **one** subject/HTML per `(subscription, windowStart)` including all `listingIds` (port weekly digest copy from #210; daily uses same template with "today" wording).
- Headers on send (worker):
  - `List-Unsubscribe: <https://…/api/notifications/{id}/unsubscribe?sig=…>`
  - `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

### Internal sweep — `POST /internal/v1/notifications/sweep`

- Body: `{ period: 'daily' | 'weekly' }`.
- Auth: same as `/internal/v1/users/next`.
- Steps:
  1. `windowStart = computeWindowStart(period, now)`.
  2. `getSubscriptionsDue(period, windowStart)`.
  3. `getAvailableListings(limit: 500)` + filter per subscription.
  4. **No matches:** `markSubscriptionNotified(subscriptionId, windowStart)` — advance clock, no job.
  5. **Matches:** render digest → `enqueueJob('resend-email', payload, { dedupeKey })`.
  6. Return `{ period, windowStart, enqueued, skippedEmpty, skippedDedupe, errors }`.

### Job lifecycle hooks

| Event | `listing-alert-digest` behavior |
| --- | --- |
| **complete** (Resend OK) | `markSubscriptionNotified`; `consecutive_failures = 0` |
| **fail** (exhausted retries or terminal 4xx) | `markSubscriptionNotified` (**move clock forward** — "we tried"); `consecutive_failures += 1`; if `>= 3` → `enabled = 0` |
| **fail** (transient, will retry) | Do **not** mark notified; do not increment consecutive_failures |

Malformed `produceTypes` → Sentry + skip subscription (no job, no mark).

### Unsubscribe (RFC 8058)

| Method | Behavior |
| --- | --- |
| `GET /api/notifications/:id/unsubscribe?sig=` | Idempotent soft-delete; redirect to `/notifications/unsubscribed` |
| `POST /api/notifications/:id/unsubscribe` | Same verification (`sig` query or body per impl); **no body required** for One-Click |

Verify HMAC with `HMAC_SECRET` or `HMAC_SECRET_PREVIOUS`.

### Worker scheduling (`apps/resend-worker`)

| Loop | Trigger | Action |
| --- | --- | --- |
| User sync | `RESEND_SYNC_POLL_MS` | Unchanged |
| Notification sweep | `NOTIFICATION_SWEEP_POLL_MS` (default **600_000** prod / **30_000** dev) | If `isPeriodDue('daily')` → sweep daily; if `isPeriodDue('weekly')` → sweep weekly |
| Email drain | Each tick after sweeps | Claim `resend-email` until empty or **token bucket exhausted** / `Retry-After` |

**`isPeriodDue` (MVP, in-memory):**

- `daily`: no sweep yet today UTC **or** last in-memory sweep &lt; 24h ago (whichever stricter — prefer calendar: "have we swept for today's `windowStart`?").
- `weekly`: same for current ISO week `windowStart`.

**Restart caveat (documented):** Worker restart may call sweep while period still "due"; `dedupe_key` prevents duplicate sends. Cost: extra DB scan — acceptable MVP. **Follow-up:** persist `last_sweep_at` JSON on Fly volume.

**Kill switch:** `BACKGROUND_WORKER_ENABLED` (after chore rename) disables all loops.

### `EMAIL_PROVIDER`

- **Always enqueue** listing-alert jobs.
- Worker `listing-alert-digest` handler: `console` → log rendered payload (redact as needed); `silent` → no-op success; `resend` → API call.

### HTTP / UI

- Throttle picker: **Daily** | **Weekly** only.
- Copy: "Email once per day with new listings near you" / "Email once per week…"
- Disabled subscriptions: show reason when `enabled = 0` (delivery failures).
- Routes: CRUD server fns, `/notifications/*`, edit route, nav link (#212 + #210 PR3).

### Delivery slices

| Slice | Delivers | Depends on |
| --- | --- | --- |
| **S0** | #260 merged | — |
| **S0.5** | `BACKGROUND_WORKER_ENABLED` rename chore | S0 |
| **S1** | `0008` migration + domain + tests | S0 |
| **S2** | sweep + dedupe_key + worker + hooks + integration tests | S1, S0.5 |
| **S3** | UI + E2E (assert `jobs` row + console log from worker) | S1 |
| **S4** | GET+POST unsubscribe + headers + failure UI + E2E | S2, S3 |

**Future Work** (call out in S1/S2 commit messages + tracking issue):

- SQL/H3 prefilter for listings (replace 500-row memory scan).
- Durable `last_sweep_at` on volume.
- Optional listing-create trigger for sub-daily latency (product decision).

### Verification & observability

| Layer | Checks |
| --- | --- |
| Unit | `windowStart` for daily/weekly with frozen UTC; dedupe enqueue skip; empty match advances `last_notified_at`; terminal fail advances + disables at 3 |
| Integration | Sweep → one job per sub/window; Resend mock gets `Idempotency-Key: dedupe_key` |
| E2E | Daily subscription → sweep → job row → worker console log; POST unsubscribe without navigation |
| Sentry | `['notifications', 'sweep', …]` vs `['notifications', 'listing-alert-digest', …]` — separate fingerprints so one bad address does not mask sweep outages |

### Open questions (remaining)

1. Job retention / prune — inherit #260 deferral.
2. Resend preferences URL — inherit #260 profile link work if needed for notification settings cross-link.

### Related

- Supersedes mechanics: #210, #212
- Builds on: #239, #264, #260
- Env rename: **separate chore PR before S2** (not bundled)

---

## Implementation checklist

- [ ] S0: #260 merged
- [ ] S0.5: `BACKGROUND_WORKER_ENABLED` chore (Fly secrets synchronized)
- [ ] S1: `0008` migration (`daily`/`weekly`, `enabled`, `consecutive_failures`) + domain tests
- [ ] S2: sweep + `dedupe_key` + digest payload + worker + fail/complete hooks
- [ ] S3: UI + E2E
- [ ] S4: GET+POST unsubscribe + RFC 8058 headers + disabled UI
- [ ] Docs: `docs/0008-notifications.md`
- [ ] Future-work issue: listing SQL prefilter + optional `last_sweep_at` + listing-insert sweep
- [ ] Close/archive #210, #212 → link #265
