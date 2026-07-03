# 0014 — Stale-asset recovery after deploys

## Problem

Vite emits content-hashed client chunks into `.output/public/assets/`, and
those files exist only inside the Docker image of the currently running Fly
machine. Deploys use `strategy = 'immediate'`, so the moment a new release
lands, every old hashed file is gone. A browser that loaded the previous
release keeps navigating client-side; TanStack Router lazy-loads each
destination route with a dynamic `import()` of a chunk whose hashed filename
no longer exists. The fetch 404s, the import throws ("Failed to fetch
dynamically imported module"), and the navigation breaks.

Two properties of our setup shape the fix:

- The router does not set `defaultPreload`, so chunks are fetched at
  navigation time, not on hover. A chunk-load failure therefore almost always
  happens when the user has already chosen to leave the current page, which
  makes a full-page load an acceptable recovery: it costs no more state than
  the navigation itself.
- TanStack Router commits the new URL to history before it loads the
  destination's chunk. Reloading after a failure therefore lands on the
  _intended destination_, served by the new build — the user's navigation
  completes instead of bouncing back.

## Plan

1. Add `src/lib/stale-asset-recovery.ts` exporting
   `installStaleAssetRecovery()`. It listens for Vite's built-in
   [`vite:preloadError`](https://vite.dev/guide/build#load-error-handling)
   window event, which fires exactly when a Vite-emitted chunk (or one of its
   CSS/JS dependencies) fails to load.
2. On failure, record a reload marker (timestamp) in `sessionStorage`, call
   `event.preventDefault()` so the underlying error is not rethrown, and
   `window.location.reload()`.
3. Loop guard: if another failure occurs within 30 seconds of the marker, do
   **not** reload. Let the error propagate to the router's error boundary
   (`RootError` in `__root.tsx`), which offers "Try again". One reload fixes
   deploy staleness; a second immediate failure means the 404 has some other
   cause and reloading would spin forever.
4. Telemetry, so the deferred work below is a decision we make from numbers:
   - `Sentry.captureMessage(…, { level: 'warning' })` with tag
     `staleAssetRecovery: 'reload'` just before reloading. The SDK's fetch
     transport uses `keepalive`, so the event usually survives the unload;
     occasional loss is acceptable.
   - `Sentry.captureException` with tag `staleAssetRecovery: 'reload-loop'`
     when the loop guard trips.
5. Install the listener from `getRouter()` in `src/router.tsx`, inside the
   existing client-only (`!import.meta.env.SSR`) block.
6. Testing: unit-test the handler with injected `storage`/`reload`/`now`
   dependencies. An E2E test is impractical (it would require serving two
   different builds mid-test); production telemetry from step 4 is the
   real-world verification.

## Future work

### Version-skew detection once assets become durable

We may later serve old hashed assets from a durable store (e.g. a Tigris
fallback for `/assets/*` misses) so old clients stop hitting 404s at all. That
change silently defeats this doc's mechanism: chunks always load, so
`vite:preloadError` never fires, and old clients keep running old code
indefinitely — worsening client↔server contract skew. Before or alongside a
durable asset fallback, ship explicit version-skew detection:

1. Every build already has a unique identifier: the git SHA baked in as
   `SENTRY_RELEASE` / `VITE_SENTRY_RELEASE` (see `apps/www/Dockerfile`). Add a
   Nitro middleware that sets an `X-PMF-Build: <sha>` header on document and
   server-function responses.
2. On the client, record the most recent server build id seen (server-function
   client middleware or a fetch wrapper) and compare it to the client's own
   baked-in `clientEnv.sentryRelease`.
3. On mismatch, set a module-level `versionSkew` flag. Do not interrupt the
   user — in-progress work (e.g. a half-filled listing form) is preserved.
4. Watch for transition intent instead: in the root route's `beforeLoad`
   (which runs on every client-side navigation before the destination chunk is
   requested), when the flag is set and this is not the initial mount, call
   `window.location.assign(location.href)` and return a never-resolving
   promise. The user's next navigation becomes a full-page load onto the new
   build, with zero extra disruption.
5. Keep the `vite:preloadError` handler as a backstop. Skew detection no-ops
   when either side lacks a build id (local dev without `SENTRY_RELEASE`).

Signals it's time to pick this up: shipping the Tigris asset fallback;
Sentry showing frequent `staleAssetRecovery` events per deploy; or shipping
backwards-incompatible server-function changes often enough that we want old
clients upgraded before they hit an error.
