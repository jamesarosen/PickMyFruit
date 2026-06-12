# 0011 — International Address Entry

## Problem

The New Listing form's "Where is it?" section is four fields (Street Address,
City, State, ZIP) whose structure is locked to US addresses:

- `lib/validation.ts` requires a 2-character `state` and a US ZIP+4 `zip`
- `lib/geocoding.ts` pins Nominatim to `countrycodes=us`
- `data/schema.server.ts` defaults `city`/`state` to `Napa`/`CA`
- the form defaults and placeholders assume Napa, CA

We want a simpler entry UX that works for international users.

## Options considered

1. **Single address autosuggest** (chosen). One combobox; the user picks a
   real place from suggestions. The suggestion response carries both the
   structured address parts and the coordinates, so picking a suggestion
   _replaces_ the current submit-time geocoding step rather than adding a
   lookup on top of it. Submit-time geocoding failure — today's worst error
   path — disappears for the autosuggest flow.
2. **Street Address + Postal/ZIP, intuit jurisdiction.** Rejected. Postal
   code formats collide across countries (a 5-digit code is valid in the US,
   Germany, France, Mexico, …), so jurisdiction cannot be reliably inferred
   from the code alone, and a wrong inference geocodes the listing onto the
   wrong continent with no feedback to the user. It also still needs a
   geocoding round-trip at submit time, keeping the failure mode autosuggest
   eliminates.
3. **Single free-text line, geocode on submit.** Rejected as the primary UX:
   no feedback until submit, typos surface as a hard "address not found"
   error, and Nominatim's best-match answer for an ambiguous one-liner can be
   silently wrong. But this is exactly the right _fallback_ for addresses the
   suggestion index doesn't know (rural properties, new construction), so we
   keep it as the manual-entry escape hatch (see UX below).

## Suggestion provider

**Photon** (`photon.komoot.io`), an OSM-based geocoder built for
search-as-you-type. Rationale:

- Nominatim's public API **forbids autocomplete** in its usage policy and is
  limited to 1 req/s, so the existing geocoder cannot power suggestions.
- Photon's public instance is free, needs no API key (no new secrets or env
  schema), covers the world, supports `lang=en`, and returns structured
  address components plus coordinates in one GeoJSON response.
- Same OSM data and privacy posture as today: the browser already sends full
  addresses to a third party (nominatim.openstreetmap.org); Photon adds
  keystrokes-as-you-type to komoot's public instance. Acceptable at MVP
  scale; if volume or policy becomes a concern, Photon is self-hostable and
  the client module isolates the endpoint behind one constant.
- Requests go directly from the browser (same invariant as `geocoding.ts`),
  so `photon.komoot.io` must be added to the CSP `connect-src` allowlist in
  `middleware/security-headers.ts`.

Nominatim stays for the manual fallback's submit-time geocoding, with
`countrycodes=us` removed and the country appended to the free-form query.

## UX

The "Where is it?" fieldset becomes:

- **One "Address" combobox** (WAI-ARIA combobox pattern: `role="combobox"`,
  `aria-expanded`, `aria-controls`, `aria-activedescendant`, listbox of
  options; ArrowUp/ArrowDown/Enter/Escape keyboard support). Typing ≥3
  characters fetches suggestions (debounced ~300 ms, stale responses
  cancelled/discarded). Picking a suggestion stores the structured address
  and coordinates and shows the chosen address in the input. Editing the
  text after selection clears the selection.
- **Manual fallback**: a "Can't find your address? Enter it manually" button
  under the combobox (also offered inline when suggestions fail or return
  nothing). It swaps the combobox for structured fields: Street Address,
  City, State/Province/Region (optional), Postal code (optional), and a
  Country select (default United States). Manual submissions geocode via the
  existing Nominatim path at submit time, as today.
- The existing privacy hint ("Others will see your neighborhood, but not
  your exact address.") and the pre-fill notice stay. Pre-fill from the last
  listing populates the combobox with the stored address _and_ its stored
  coordinates, so an untouched pre-fill submits without any new lookup.
- Validation error if submitting with neither a selected suggestion, a
  pre-fill, nor completed manual fields: "Choose a suggested address or
  enter it manually."

## Data model

`listings` keeps its structured columns (cards, reveal flow, and pre-fill all
consume them) with these changes:

- `state`: becomes nullable; `DEFAULT 'CA'` removed. Many jurisdictions have
  no meaningful region line. (Suggestions return full region names like
  "California"; existing rows keep "CA". Both display fine.)
- `city`: stays `NOT NULL`; `DEFAULT 'Napa'` removed. Derived from the
  suggestion via a locality fallback chain (city → district → county →
  state → country) so it is always populated.
- `zip`: column kept (still `zip` in SQLite); validation relaxed to a
  free-text postal code (max 20), UI label "Postal code".
- `country`: new `TEXT NOT NULL` column, ISO 3166-1 alpha-2, `DEFAULT 'US'`
  (also the correct backfill for all existing rows).

Migration via `pnpm db:generate` (the `state` nullability change forces
SQLite's table-rebuild strategy — inspect the generated SQL for index/FK
preservation), then `pnpm db:migrate`.

Derived types ripple: `AddressFields` and `RevealedAddress` gain `country`
and a nullable `state`; `getUserLastAddress` additionally returns `lat`/`lng`
and `country` for pre-fill; the API `createListingSchema` gains `country` and
the relaxed `state`/`zip` rules. A new `formatListingLocation({ city, state,
country })` helper renders the location line everywhere one is shown
(ListingCard, listing detail, reveal section): join non-empty parts of
`[city, state, countryName-when-not-US]`, with the country name from
`Intl.DisplayNames`.

Out of scope: addresses remain immutable after creation (unchanged), email
templates (contain no address), nearby/area queries (pure lat/lng/H3),
translating the UI itself.

## Known simplifications

- The street line for a suggestion is composed as `"{housenumber} {street}"`,
  which is US/UK ordering; some countries write the number after the street.
  The stored coordinates are exact regardless; this only affects the text
  shown on reveal. Acceptable for now; revisit if international users report
  it.
- Photon's public instance has a fair-use policy and no SLA. The combobox
  degrades gracefully (suggestion failure → inline notice + manual entry),
  so an outage never blocks listing creation.
- Place-level suggestions (a bare village/POI name with no street) are
  accepted intentionally: rural properties and named orchards/farms are
  legitimate listing locations even when OSM lacks a street address. The
  owner sees exactly what they picked; public display stays
  neighborhood-level either way.
- Switching manual → search → manual discards manual edits (the fields
  re-mount with defaults from the current selection or last listing).
  Acceptable for a rarely-toggled escape hatch.

## Implementation plan

Double-loop TDD: step 1 writes the failing outer-loop E2E tests; steps 2–8
are inner loops (failing unit test → implement → green) that progressively
make the outer loop pass; step 9 closes the outer loop; step 10 is
adversarial review.

1. **Outer loop (red)**: add a `photon-mock.ts` Playwright fixture (chained
   like `nominatim-mock.ts`/`tile-mock.ts`, serving deterministic features —
   e.g. a query containing "Paris" yields a French address). Write failing
   E2E tests: (a) create a listing by picking a French autosuggest result;
   detail page shows "Paris, France"; (b) manual-entry fallback creates a
   listing via Nominatim mock. Update `listing-new.test.ts` and
   `address-autofill.test.ts` expectations to the new UX.
2. **Suggestion client** (`src/lib/address-suggestions.ts`): unit-test-first
   — Photon GeoJSON → `AddressSuggestion { label, address, city, state,
postcode, countryCode, lat, lng }` mapping, the locality fallback chain
   (`test.each`), label composition, empty/error/malformed responses
   (mirroring `geocoding.ts` error classes and Sentry usage).
3. **Schema + migration**: update `schema.server.ts` (nullable `state`, no
   geo defaults, new `country`), `pnpm db:generate`, inspect SQL,
   `pnpm db:migrate`; update `seed.server.ts` (`country: 'US'`) and the
   `AddressFields` type.
4. **Validation**: unit-test-first — `listingFormSchema` /
   `createListingSchema` accept international shapes (optional `state`,
   free-text `postal code`, required 2-letter `country`), reject the old
   invalid cases that still matter (overlong fields, bad country code).
5. **Location formatting** (`src/lib/format-location.ts`):
   `formatListingLocation` with `test.each` across US/CA/no-state/non-US
   cases; adopt in `ListingCard`, listing detail, and the reveal section;
   update `RevealedAddress` and `listingShapeFor` for `country` and nullable
   `state`.
6. **Geocoding fallback**: drop `countrycodes=us` from `geocoding.ts`,
   include country in the query; update `tests/geocoding.test.ts`.
7. **`AddressAutosuggest` component**: custom combobox (Kobalte's combobox
   has known SSR/hydration issues in this app — see the `clientMounted`
   workaround in `ListingForm.tsx`). Component tests: debounce, stale-
   response discard, keyboard navigation, selection, clearing on edit,
   error → manual-entry affordance.
8. **Form integration**: rework the "Where is it?" fieldset in
   `ListingForm.tsx` (combobox + manual mode + pre-fill-as-selection), update
   the POST handler in `routes/api/listings.ts`, `getUserLastAddress`, and
   `getMyLastAddress`; add `photon.komoot.io` to `connect-src` in
   `security-headers.ts`. Keep the sessionStorage magic-link round-trip
   carrying coords.
9. **Outer loop (green)**: run the full E2E suite; fix until green; run
   `bash bin/after-turn.sh`.
10. **Adversarial review**: up to three rounds. Each round, an independent
    reviewer attacks the diff (correctness, i18n edge cases, a11y of the
    combobox, privacy/CSP, migration safety, test honesty); fix accepted
    findings and re-run the gates. Stop early if a round produces no
    must-fix findings.
