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

On mount, the home page asks the browser for the user's position via the same
`requestCurrentLocation()` wrapper introduced in 0012 (the browser shows its
permission prompt).

- **Granted** → the map centers on the user's coordinates at a
  neighborhood-scale zoom, so it frames the area around them.
- **Denied / unavailable / timed out / unsupported** → the map keeps its
  current behavior: fit the bounds of the returned listing groups, or fall
  back to Napa City Hall when there are none.

The position resolves asynchronously and may arrive before or after the map
finishes loading. Both orders are handled: the initial camera reads whatever
position is known at setup time, and a reactive effect re-centers the map
(`flyTo`) if the position resolves later.

### Prompting on the home page

Unlike doc 0012, which scoped the prompt to the intentful New Listing form,
this prompts on the home page — the most-trafficked, often-anonymous page —
on mount. That is the explicit request ("on the home page … ask to use the
browser's geolocation API"). The cost to weigh: a visitor who picks "Block"
sets a sticky per-origin decision that also denies the New Listing form's
later, more clearly-motivated request. We accept this for now because the map
degrades gracefully on denial (Napa framing) and the form already tolerates
denial (Napa-biased suggestions). If unprompted home-page prompting proves
costly, the follow-up is to gate it behind a "Use my location" control on the
map.

### Why centering, not re-querying

The loader runs on the server and cannot know the client's position, so it
continues to fetch the listings nearest Napa City Hall (the launch anchor).
This is a presentation change — _where the map looks_ — not a change to
_which listings are fetched_. For the Napa beta that is the desired behavior:
a granted user is in Napa, near the same listings, and the map simply frames
their neighborhood instead of the whole returned set. Re-querying by the
client's position is a possible later step but is out of scope here.

### Trade-off: granted position overrides fit-to-bounds

When the position is granted, the map centers on the user rather than fitting
all returned listing groups. Because the loader fetches the listings nearest
Napa City Hall (not the user — see below), a user far from Napa centers on
their own neighborhood with **every** marker off-screen until they pan; the
listings grid below the map still shows the full set. This is the literal
intent of "center the map there," and is acceptable for the Napa beta where
granted users are local. The non-granted path is unchanged, so the common
case keeps the fit-to-bounds framing. Making the map follow the data for
distant users means re-querying by the client's position — deferred (see
_Known simplifications_).

### Where the logic lives

- `src/lib/listings-map-camera.ts` — a pure `planListingsMapCamera(hasGroups,
userCenter)` that returns either a `center`/`zoom` camera or a
  `fit-groups` instruction. This isolates the decision from MapLibre so it is
  unit-testable without a map. It also exports `NAPA_CITY_HALL_LNGLAT`,
  derived from the shared `NAPA_CITY_HALL` constant in `src/lib/geolocation.ts`
  so the map and the autosuggest agree on one Napa anchor (the map previously
  carried its own slightly different copy).
- `src/components/ListingsMap.tsx` — consumes the plan for the initial camera,
  re-centers via a deferred effect when a position arrives after setup, and
  reflects the live center in a `data-map-center` attribute so end-to-end
  tests can assert it.
- `src/routes/index.tsx` — requests the position on mount and passes it to
  `ListingsMap` as `center`; the loader's Napa query point now uses the shared
  `NAPA_CITY_HALL` constant.

## Testing

Double-loop TDD:

- **Outer loop** (`tests/e2e/home-map-geolocation.test.ts`): Playwright's
  `geolocation`/`permissions` context options simulate grant and denial.
  - granted (Sonoma Plaza, clearly west of Napa) → the map's
    `data-map-center` settles on the granted coordinates.
  - denied → the map centers on Napa (the returned listing's bounds), never
    on the granted Sonoma point.
- **Inner loop** (`tests/listings-map-camera.test.ts`): unit tests for
  `planListingsMapCamera` — user position wins over groups, falls back to
  fitting groups, then to Napa City Hall, and the fallback uses the shared
  constant.

## Known simplifications

- The loader still queries by Napa City Hall; only the map's framing follows
  the user. Client-side re-query by position is future work.
- A granted position is whatever was measured at mount; the map does not
  follow the user if they move.
