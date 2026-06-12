# 0012 — Geolocation-based location bias for address suggestions

## Problem

The New Listing form's address autosuggest (doc 0011) queries Photon with no
location bias, so short queries rank results by global prominence: typing
"400 school st" from Napa surfaces streets on other continents before the one
around the corner. Photon supports a
[location bias](https://github.com/komoot/photon/blob/master/docs/api-v1.md#location-bias)
(`lat`/`lon` query parameters) that re-ranks results toward a focus point
without excluding anything.

## Approach

- On mount, the autosuggest asks the browser for the user's position via the
  Geolocation API (`navigator.geolocation.getCurrentPosition`).
  - **Granted** → use the user's coordinates as the Photon bias.
  - **Denied / unavailable / timed out / unsupported** → fall back to Napa
    City Hall (`38.2967151, -122.292037`), the project's launch city anchor.
  - **While the prompt is open** → the fallback bias is already in place, so
    a user who types before answering still gets deterministic (Napa-biased)
    results rather than unbiased ones.
- Bias is passed as `lat`/`lon` on the suggest request. Photon's defaults for
  the optional tuning knobs (`zoom` 12, `location_bias_scale` 0.4) suit a
  city-scale bias, so they are not sent.
- **Prepopulation (granted only)**: when the user grants access, the field is
  still empty, and there is no pre-fill from a previous listing, the user's
  coordinates are reverse-geocoded via Photon's `/reverse` endpoint and the
  result is applied exactly like a picked suggestion (label in the input,
  structured address + coordinates reported via `onSelect`). Any failure is
  silent — prepopulation is an optional nicety, never an error.

### Where the logic lives

`AddressAutosuggest` owns the whole flow. Both consumers of the position —
the suggest bias and the prepopulated selection — are concerns of that
component, and its existing `onSelect` contract already propagates a
selection (with coordinates) to `ListingForm`, so the form needs no changes.
A side effect worth naming: the browser permission prompt appears when the
autosuggest mounts (i.e. on opening the New Listing form), not on first
keystroke. That is the requested behavior.

New module `src/lib/geolocation.ts` wraps the callback-style
`getCurrentPosition` in a promise:

- `requestCurrentLocation(): Promise<LocationBias | null>` — `null` for
  every non-success outcome (denied, unavailable, timeout, API missing).
  Callers never see a rejection; denial is a normal outcome, not an
  exception, so nothing is reported to Sentry.
- `NAPA_CITY_HALL: LocationBias` — the shared fallback constant.

`src/lib/address-suggestions.ts` gains:

- an optional `bias` option on `fetchAddressSuggestions`, appended as
  `lat`/`lon`;
- `fetchReverseGeocodedAddress(location, { signal })` — `GET /reverse` with
  `limit=1&lang=en`, mapped through the same feature→suggestion code path as
  search results; resolves `null` when Photon returns nothing usable, throws
  `SuggestionsUnavailableError` on transport/shape failures (the component
  swallows it for prepopulation).

### Races guarded in the component

- **User types before the position resolves** → suggest requests fire with
  the fallback bias; later requests pick up the granted coordinates.
- **User types (or picks) before the reverse geocode resolves** → the
  prepopulation result is discarded; the user's text is never clobbered and
  `onSelect` is not called with a stale selection. Guarded by re-checking
  the "untouched" condition after each `await`.
- **Pre-fill from the last listing** (`defaultSelection`) → prepopulation is
  skipped entirely; the reverse request is never made.
- **Unmount** (e.g. switching to manual entry) → in-flight reverse geocode is
  aborted via the component's existing cleanup.

## Security

`Permissions-Policy` currently sends `geolocation=()`, which hard-blocks the
Geolocation API for the whole site. It becomes `geolocation=(self)` — only
our own origin may use it; embedded third-party content (none today,
`frame-src 'none'`) stays blocked. The CSP `connect-src` already allows
`https://photon.komoot.io`, which covers `/reverse`.

Privacy: when granted, the user's raw coordinates are sent to Photon
(komoot's public instance) as bias parameters and once to `/reverse`. This
matches the privacy posture accepted in doc 0011 — the browser already sends
full addresses to Photon and Nominatim. Coordinates are not logged or
breadcrumbed on our side.

## Testing

Double-loop TDD:

- **Outer loop** (`tests/e2e/location-bias.test.ts`): the `photon-mock`
  fixture additionally serves `/reverse` and records the bias parameters of
  each search request. Playwright's `geolocation`/`permissions` context
  options simulate grant and denial.
  - granted → suggest requests carry the granted coordinates; the address
    field is prepopulated from the reverse geocode and submits as a normal
    selection.
  - denied (Playwright's default) → suggest requests carry the Napa City
    Hall coordinates; `/reverse` is never called; the field stays empty.
- **Inner loops**: unit tests for `requestCurrentLocation` (success and each
  failure mode), the `lat`/`lon` request parameters, `/reverse`
  fetching/mapping/failures, the component's bias hand-off, prepopulation,
  its guards, and the `Permissions-Policy` change.

## Known simplifications

- The position is requested with `enableHighAccuracy: false` and a cached
  fix up to five minutes old is accepted — city-scale bias does not need GPS
  precision, and a coarse cached answer is faster and cheaper on battery.
- The home-page map keeps its own hard-coded Napa center; migrating it to
  geolocation is out of scope here.
- If the user grants the permission but later moves, the bias is whatever
  was measured at mount. Fine for a form that lives for one listing.
