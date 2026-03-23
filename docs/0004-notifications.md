# Notification Subscriptions

Users can subscribe to receive email notifications when new produce listings appear near them.

## Feature Overview

- A user creates a subscription: location (geocoded address + radius) and optional produce-type filter
- When a new listing is posted that matches one or more subscriptions, subscribers get an email
- Users can manage (edit, pause, delete) subscriptions and unsubscribe via a one-click link in every email
- Two throttle periods: **immediately** (implemented as hourly) and **weekly**

## Architecture Decisions

### Cron Infrastructure

The Fly.io durable volume can only be mounted to one machine at a time, so the notification runner must execute on the same machine as the web process. We use an HTTP cron endpoint:

- The web app exposes `POST /api/cron/notify` protected by `Authorization: Bearer {CRON_SECRET}`
- A `supercronic` process runs in the same Docker container and calls `http://localhost:PORT/api/cron/notify` on a schedule
- This keeps the runner co-located with the DB volume, requires no separate infrastructure, and is testable with `curl`

`CRON_SECRET` must be set in `fly.toml` secrets. The endpoint returns 401 if the header is missing or wrong, 200 with a JSON summary if the run succeeded.

### Geographic Matching

Listings already store an H3 index (`h3Index`). Subscriptions store a center cell (`centerH3`) at the appropriate H3 resolution for the chosen radius, and the radius in H3 ring distance (`ringSize`). Matching is: `h3.gridDisk(subscription.centerH3, subscription.ringSize).includes(listing.h3Index)`.

H3 resolutions used (from `subscription-matcher.ts`):
- Ring 0 (~1 mi radius): resolution 8
- Ring 1–2 (~3–6 mi): resolution 7
- Ring 3–6 (~10–30 mi): resolution 6

### Location UX

No map is required. After geocoding an address, show a text confirmation under the address field:

> Searching within ~3 miles of Napa, CA 94558

This gives users confidence that the system understood their location without requiring a Leaflet dependency. The geocoded place name (from Nominatim's `display_name`) is stored on the subscription for display.

### Geocoding

Nominatim (free, no API key) until rate-limited. Error handling:
- 200 with empty results → return `null` (no match found)
- 429 / 5xx → throw a typed `GeocodingError`; callers surface a retry message; Sentry captures the error with the queried address and response status

### HMAC-Signed Unsubscribe URLs

Every notification email includes a one-click unsubscribe link:

```
/api/notifications/{subscriptionId}/unsubscribe?sig={hmac}
```

The HMAC is computed over `subscriptionId` only — **not** `userId`. The server looks up the subscription owner from the DB using `subscriptionId`. This avoids embedding a stable internal identifier in every email.

The `markListingUnavailable` action in listing emails uses a separate HMAC scoped to `{listingId}:{userId}` (the listing owner's ID), so only the owner can mark their own listing unavailable.

### Subscription Limit

Max 10 subscriptions per user, enforced atomically via a SQLite `BEFORE INSERT` trigger:

```sql
CREATE TRIGGER enforce_subscription_limit
BEFORE INSERT ON notification_subscriptions
BEGIN
  SELECT RAISE(ABORT, 'subscription_limit_exceeded')
  WHERE (SELECT COUNT(*) FROM notification_subscriptions
         WHERE user_id = NEW.user_id AND deleted_at IS NULL) >= 10;
END;
```

The API catches this error and returns a 422 with a user-facing message.

### Idempotency

The Resend idempotency key is based on the throttle window start time, not wall-clock date:

```
notify-{subscriptionId}-{throttlePeriod}-{windowStartEpochSeconds}
```

This survives midnight UTC rollover and cron retries within the same window.

### Throttle Periods

| Period | Label | Schedule | Meaning |
|--------|-------|----------|---------|
| `immediately` | Immediately | Hourly cron | Notify within ~1 hour of the listing being posted |
| `weekly` | Weekly | Weekly cron (Monday 8am local TZ) | Digest of all matching listings from the past 7 days |

A subscription is "due" when `lastNotifiedAt IS NULL OR lastNotifiedAt < windowStart`.

The runner processes throttle periods **sequentially**, not in parallel, to avoid SQLite write contention.

---

## Pull Request Order

### PR 1 — Data Foundation

**Goal:** Subscriptions can be created and managed via API with no UI. The matching and signing logic is fully tested before any email is sent.

**Files:**
- `apps/www/src/data/schema.ts` — `notificationSubscriptions` table
- `apps/www/drizzle/000N_add_notification_subscriptions.sql` — migration (generated)
- `apps/www/src/lib/validation.ts` — `createSubscriptionSchema`, `updateSubscriptionSchema`
- `apps/www/src/lib/hmac.ts` — `signUnsubscribeUrl`, `verifyUnsubscribeUrl` (no userId in URL)
- `apps/www/src/lib/geocode.ts` — `geocodeAddress` with typed `GeocodingError` for 429/5xx
- `apps/www/src/lib/subscription-matcher.ts` — `subscriptionMatchesListing`
- `apps/www/src/lib/subscription-labels.ts` — human-readable throttle period labels
- `apps/www/src/data/queries.ts` — `createSubscription`, `getSubscriptions`, `updateSubscription`, `deleteSubscription`, `getSubscriptionsDue`, `getAvailableListings`, `markSubscriptionNotified`
- `apps/www/src/api/notifications.ts` — server functions wrapping the above queries
- `apps/www/src/lib/env.server.ts` — add `HMAC_SECRET`, `CRON_SECRET`
- Tests: `queries.notifications.test.ts`, `subscription-matcher.test.ts`, `hmac.test.ts`, `geocode.test.ts`, `validation.test.ts`

**Schema:**
```sql
CREATE TABLE notification_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  label       TEXT,                    -- user-supplied name, optional
  center_h3   TEXT NOT NULL,           -- H3 cell at chosen resolution
  resolution  INTEGER NOT NULL,        -- H3 resolution (6, 7, or 8)
  ring_size   INTEGER NOT NULL,        -- H3 gridDisk radius
  place_name  TEXT NOT NULL,           -- geocoded display name for UI confirmation
  produce_types TEXT,                  -- JSON array of slugs, NULL = all types
  throttle_period TEXT NOT NULL CHECK (throttle_period IN ('immediately', 'weekly')),
  last_notified_at INTEGER,            -- Unix epoch seconds
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER
);

CREATE INDEX notification_subscriptions_user_id_idx
  ON notification_subscriptions(user_id);
CREATE INDEX notification_subscriptions_throttle_notified_idx
  ON notification_subscriptions(throttle_period, last_notified_at)
  WHERE deleted_at IS NULL AND enabled = 1;

CREATE TRIGGER enforce_subscription_limit ...  -- see above
```

**Key constraints:**
- `updateSubscription` must require `centerH3` and `resolution` together (never one without the other)
- `getSubscriptionsDue` cutoff uses `Math.floor(cutoff.getTime() / 1000)` (integer epoch seconds)
- The composite index must appear in **both** `schema.ts` and the migration (so `db:push` creates it)

**Risks and mitigations:**

| Risk | Mitigation |
|------|-----------|
| Migration is hard to undo in production | Review schema carefully before merging; test `db:migrate` in E2E environment |
| Subscription limit race condition | SQLite `BEFORE INSERT` trigger (100% enforcement) |
| `centerH3`/`resolution` mismatch on partial update | Validation schema rejects any update that includes one but not both |
| Composite index missing from `db:push` dev environment | Add index to `schema.ts` Drizzle definition, not only migration SQL |
| Geocoding 429/503 swallowed silently | `GeocodingError` type; Sentry capture with address + status in callers |

**Testing approach:**
- Integration tests against a real test DB (same pattern as `queries.notifications.test.ts`)
- `subscription-matcher.test.ts`: `test.each` over boundary cells (in ring, on edge, outside)
- `hmac.test.ts`: sign → verify round-trip; tampered sig rejected; different subscriptionId rejected
- `geocode.test.ts`: 200+results, 200+empty, 429 throws `GeocodingError`, 500 throws `GeocodingError`, Sentry capture verified

---

### PR 2 — Notification Runner + Email

**Goal:** Running the cron script against a seeded DB sends correctly-formatted emails. No UI required.

**Files:**
- `apps/www/src/lib/notification-runner.ts` — `runForThrottlePeriod`, `runAll`
- `apps/www/src/lib/email-templates.ts` — `buildNotificationEmailSubject`, `buildNotificationEmailHtml`
- `apps/www/src/routes/api/cron.notify.ts` — HTTP endpoint, validates `CRON_SECRET`, calls `runAll`
- `apps/www/src/bin/notify.ts` — thin CLI wrapper for local dev / manual triggering
- `apps/www/fly.toml` — `supercronic` process and cron schedule
- `apps/www/Dockerfile` — install `supercronic`, add crontab
- Tests: `notification-runner.test.ts`, `email-templates.notifications.test.ts`

**Notification runner contract:**
1. `getSubscriptionsDue(throttlePeriod, cutoff)` — returns subscriptions due for this period
2. For each subscription: `getAvailableListings(limit: 500)` → filter via `subscriptionMatchesListing` → if matches, send email → `markSubscriptionNotified`
3. Per-subscription errors are caught, reported to Sentry, and do not abort other subscriptions
4. Returns a structured summary `{ period, sent, skipped, errors }`

**Email:**
- Subject: `"3 new produce listings near you"` (immediately) / `"3 produce listings near you this week"` (weekly)
- Body includes listing title, location, poster name, link
- Footer includes **both**: "Manage your notifications" link AND "Unsubscribe from this subscription" one-click link
- `List-Unsubscribe` header present (RFC 8058)

**Idempotency key:** `` `notify-${sub.id}-${throttlePeriod}-${windowStartEpochSeconds}` ``

**HMAC fix:** `markListingUnavailable` in listing emails verifies `HMAC(listingId:userId)` and adds `AND listings.userId = :userId` to the update — same as delete-subscription pattern.

**Key constraints:**
- Run `immediately` and `weekly` periods sequentially (not `Promise.all`) — avoid SQLite write contention
- Pass `limit: 500` to `getAvailableListings` as a safeguard; log a warning if the limit is hit
- Malformed `produceTypes` in the DB → Sentry capture + **skip** the subscription (not match-all)

**Risks and mitigations:**

| Risk | Mitigation |
|------|-----------|
| Idempotency key resets at midnight UTC | Window-based key includes `windowStartEpochSeconds` |
| Email flood if `markSubscriptionNotified` fails after send | Idempotency key covers 24h for Resend; window-based key prevents re-send within same window |
| HMAC lets any subscriber mark a listing unavailable | HMAC message includes listing owner's `userId`; server verifies ownership |
| SQLite `SQLITE_BUSY` from concurrent writes | Sequential throttle period processing |
| Listing table grows beyond memory | `LIMIT 500`; log warning at limit; document as known constraint |
| `HMAC_SECRET` rotation invalidates in-flight emails | Document in operator runbook: rotating the secret invalidates all existing unsubscribe links; users must re-receive email or unsubscribe via the UI |

**Testing approach:**
- `notification-runner.test.ts` against real test DB (seed subscriptions, seed listings, assert `sendEmail` calls)
- Must include: "subscription notified 30 min ago is skipped by hourly runner" (the most important invariant)
- Must include: "subscription with malformed produceTypes is skipped, not matched"
- Mock the email sender (not the DB) — verify call arguments including unsubscribe URL
- `email-templates.notifications.test.ts`: snapshot or structural assertion on HTML output; verify unsubscribe link present

---

### PR 3 — UI + E2E

**Goal:** Users can manage subscriptions in the browser. E2E tests cover the full subscription → notification flow using `EMAIL_PROVIDER=console`.

**Files:**
- `apps/www/src/components/SubscriptionForm.tsx` and `.css`
- `apps/www/src/components/ProduceTypeMultiSelect.tsx` and `Combobox.css`
- `apps/www/src/routes/notifications/new.tsx` and `.css`
- `apps/www/src/routes/notifications/index.tsx` and `.css`
- `apps/www/src/routes/notifications/$id.edit.tsx` and `.css`
- `apps/www/src/routes/notifications/unsubscribed.tsx`
- `apps/www/src/routes/api/notifications.$id.unsubscribe.ts`
- `apps/www/src/components/PageHeader.tsx` — add "Notifications" nav link
- `apps/www/tests/e2e/notifications.test.ts`

**Location UX (no map):**
- Address search field with a "Search" button
- After geocoding: show confirmation text below the field:
  `Searching within ~3 miles of Napa, CA (Napa County, California)` (using Nominatim `display_name`)
- This text is the same data used for matching — gives users direct confidence
- Geocoding error states: "Could not find that address — try a nearby city" (no results) and "Location search is temporarily unavailable — try again in a moment" (429/5xx)

**Accessibility requirements (from review):**
- At the 10-subscription limit: render `<span>` (not `<Link>`) for "Add a subscription" — not navigable
- `<Input type="email">` (not `type="url"`) for the "Deliver to" field; `value={user()?.email ?? ''}`
- Range slider: `aria-valuetext={RING_SIZE_LABELS[ringSize()]}` + `aria-describedby` on the value label
- Delete confirmation: focus first confirmation button when confirmation panel appears; restore focus to "Delete" when cancelled
- `<label for="...">` on ProduceTypeMultiSelect pointing to the combobox input id
- Empty state on `/notifications`: descriptive `<p>` with context, not just "No subscriptions yet."

**Unsubscribe flow:**
- `GET /api/notifications/{id}/unsubscribe?sig={hmac}` verifies signature, deletes (idempotent), redirects to `/notifications/unsubscribed`
- `/notifications/unsubscribed` copy is accurate for both fresh delete and already-deleted cases: "You are not subscribed to this notification."

**Risks and mitigations:**

| Risk | Mitigation |
|------|-----------|
| Nominatim rate limit breaks address search in high-traffic demo | Sentry alert on `GeocodingError`; graceful error message; document plan to switch provider |
| Geocoded result shown in UI differs from what's matched | Confirmation text is derived from the same `centerH3`/`resolution` stored on the subscription — not a re-geocode |
| E2E tests flaky on timing (geocode, email) | Stub Nominatim in E2E; use `EMAIL_PROVIDER=console` and parse log output for unsubscribe URL |

**Testing approach:**
- E2E: create subscription → verify it appears in list → trigger cron endpoint directly → verify email logged to console → follow unsubscribe URL → verify subscription removed
- Stub Nominatim responses with a fixture (no real HTTP in E2E)
- Test the at-limit state: create 10 subscriptions → verify "Add a subscription" is not a link

---

## Known Gaps / Deferred

- Daily throttle period (add `daily` to the `CHECK` constraint and runner when needed)
- Geographic index on listings for server-side radius filter (current approach loads up to 500 listings into memory)
- Key rotation strategy for `HMAC_SECRET` (operator runbook documents the tradeoff)
- Interactive map for subscription coverage visualization

## Environment Variables

| Variable | Required in prod | Purpose |
|----------|-----------------|---------|
| `HMAC_SECRET` | Yes | Signs unsubscribe and mark-unavailable URLs |
| `CRON_SECRET` | Yes | Authenticates `POST /api/cron/notify` requests |
| `NOMINATIM_USER_AGENT` | Yes | Required by Nominatim ToS (app name + contact) |
