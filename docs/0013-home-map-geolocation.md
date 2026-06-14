# 0013 — Geolocation-centered home map

## Problem

The home page (`/`) shows an "Available Now" map of nearby listings. Its
camera is fixed to Napa, the launch city: when listings exist it fits their
bounds, and when there are none it centers on a hard-coded Napa City Hall
point. A visitor browsing from another part of the Bay Area has no way to see
"what's near me" — the map always frames Napa.

Doc 0012 added geolocation to the New Listing form's address autosuggest but
deliberately left the home map out of scope. This doc closes that gap.

## Approach

The map keeps its existing default framing: fit the bounds of the returned
listing groups (the launch city, Napa), or fall back to a hard-coded Napa
City Hall point when there are none. Nothing changes on load, and the page
does **not** ask for the user's position on mount.

Centering on the user is **opt-in**. A "Center" button (Lucide `locate`
icon) sits at the right edge of the "Available Now" header. Clicking it asks
the browser for the user's position via the `requestCurrentLocation()`
wrapper from 0012 (the browser shows its permission prompt only then):

- **Granted** → the map pans onto the user's coordinates, **keeping its
  current zoom**.
- **Denied / unavailable / timed out / unsupported** → nothing happens; the
  map stays where it is. Denial is silent.

The pan keeps the current zoom rather than forcing one for two reasons. It
preserves the default fit-to-bounds zoom (a forced lower zoom looked too far
out), and a zoom change would trip the `zoomend` handler, which re-buckets
the H3 grouping resolution and clears any area the user has selected — so the
recenter would otherwise discard that selection and its `?area` URL state.

The position flows to the map through the same `center` prop the initial
camera reads; because the click happens after load, a deferred reactive
effect (`flyTo`) performs the pan.

### Why prompting on click, not on mount

An earlier iteration prompted on mount. That hit the most-trafficked, often-
anonymous page with a permission dialog before any interaction, and a "Block"
choice is sticky per-origin — it would also deny the New Listing form's
later, more clearly-motivated request. Gating behind an explicit "Center"
click keeps the prompt intentful, matching the posture doc 0012 took for the
New Listing form.

### Why centering, not re-querying

The loader runs on the server and cannot know the client's position, so it
continues to fetch the listings nearest Napa City Hall (the launch anchor).
Centering is a presentation change — _where the map looks_ — not a change to
_which listings are fetched_. A user far from Napa who clicks "Center" pans
to their own neighborhood with the Napa markers off-screen; the listings grid
below the map still shows the full set. That is the literal intent of the
button, and it only happens on an explicit click. Re-querying by the client's
position is a possible later step but is out of scope here.

### Where the logic lives

- `src/lib/listings-map-camera.ts` — a pure `planListingsMapCamera(hasGroups,
userCenter)` that returns either a `center`/`zoom` camera or a
  `fit-groups` instruction. This isolates the decision from MapLibre so it is
  unit-testable without a map. It also exports `NAPA_CITY_HALL_LNGLAT`,
  derived from the shared `NAPA_CITY_HALL` constant in `src/lib/geolocation.ts`
  so the map and the autosuggest agree on one Napa anchor (the map previously
  carried its own slightly different copy). The home map only ever supplies
  `userCenter` after a click (via the deferred pan), so on load it always
  takes the `fit-groups` / Napa-fallback path; the `center` branch keeps the
  decision total and reusable.
- `src/components/ListingsMap.tsx` — consumes the plan for the initial camera,
  pans via a deferred effect when a `center` arrives after setup, and reflects
  the live camera in `data-map-center` / `data-map-zoom` attributes so
  end-to-end tests can assert it.
- `src/routes/index.tsx` — renders the "Center" button, asks for the position
  on click, and passes it to `ListingsMap` as `center`; the loader's Napa
  query point uses the shared `NAPA_CITY_HALL` constant.

## Testing

Double-loop TDD:

- **Outer loop** (`tests/e2e/home-map-geolocation.test.ts`): Playwright's
  `geolocation`/`permissions` context options simulate grant and denial.
  - granted, no click → the map stays on Napa (proves it never asked on load).
  - granted, click "Center" → `data-map-center` settles on the granted
    coordinates and `data-map-zoom` is unchanged (the default zoom is kept).
  - denied, click "Center" → the map stays on Napa, never near the granted
    Sonoma point.
- **Inner loop** (`tests/listings-map-camera.test.ts`): unit tests for
  `planListingsMapCamera` — user position wins over groups, falls back to
  fitting groups, then to Napa City Hall, and the fallback uses the shared
  constant.

## Known simplifications

- The loader still queries by Napa City Hall; only the map's framing follows
  the user. Client-side re-query by position is future work.
- A clicked position is whatever was measured at click time; the map does not
  follow the user if they move.
