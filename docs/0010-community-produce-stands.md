# 0010: Community Produce Stands

## Summary

A **Community Produce Stand** is a take-it-or-leave-it / Little Free
Library–style produce fixture: a physical, semi-public spot where neighbors
can take produce and (optionally) drop produce off. It is the purest "build
for absence" listing — it runs entirely when the host isn't there.

A stand is **just another produce type**, not a separate kind of listing. It
is the `produce-stand` entry in the produce catalog (`produce-types.csv`).
Because a stand is take-it-or-leave-it with no single produce noun, its inquiry
copy names the stand itself rather than a fruit:

> **John wants to visit your produce stand**

(Non-stand listings keep the shipped "John wants your apples" framing.)

Two small, orthogonal attributes give a stand its behavior:

| Ingredient               | Source                                   | Notes                                   |
| ------------------------ | ---------------------------------------- | --------------------------------------- |
| `type = 'produce-stand'` | produce catalog                          | this is what makes a listing a stand    |
| `accepts_drop_offs`      | new in 0010                              | two-way (take **and** give)             |
| address-release policy   | [0009](./0009-address-release-policy.md) | **orthogonal** — either policy is valid |

There is **no listing "kind" column**. A produce stand can use either
address-release policy; the stand-ness and the policy are independent
choices.

## Schema (migration `0010`)

```sql
-- Two-way (take-and-give) flag. Take-only listings keep the default (0).
ALTER TABLE listings ADD COLUMN accepts_drop_offs INTEGER NOT NULL DEFAULT 0;
```

No table or `kind` column is added. The accountable steward is the listing's
existing owner (a stand can't be ownerless — creating any listing requires
authentication). The raw-whole-produce restriction is a global, unmodifiable
constant for now; a per-listing `restrictions` table is future work.

## No typed take/drop-off intent

An earlier draft recorded a per-reveal `intent` (`take` | `dropoff`) to seed a
future liquidity signal. We dropped it. A take and a drop-off reach the **same**
address and map — declaring which one _before_ seeing the location is a choice
the visitor can't act on differently, so it's pure friction in front of the
thing they came for. A take-it-or-leave-it stand invites both behaviors at once;
pre-declaring one is artificial.

The two things that felt intent-specific turn out not to be:

- **Drop-off guidance** is a property of the _stand_ (it accepts drop-offs),
  not of the visitor — so it's shown to everyone who reveals a drop-off stand.
- **Steward identity** is already intent-independent.

So `revealListingAddress(listingId)` stays exactly as 0009 shipped it — a bare
id, one generic reveal — and `address_reveals` gains no column. The only thing
lost is a take-vs-drop-off count, which would have been a noisy curiosity-click
signal anyway; a real liquidity signal is better captured later at a confirmed
transaction (see Future work).

## Gated steward identity

Stands show **"Maintained by {name}"** as a trust signal, released under the
**same gate as the address** (`on_verified_request` × verified viewer). The
security requirement is enforced at the **serialization boundary**, not in the
UI:

- `stewardName` is added to `VerifiedPublicListing` and `PrivateListing` only.
- `PublicListing` does **not** carry the field, so an anonymous or
  unverified viewer's response **cannot** contain it. Hiding it is a
  data-shape guarantee, not a CSS concern.
- The reveal server fn attaches `stewardName` only when the listing's
  `type === 'produce-stand'`, and only the verified/owner tiers reach that
  branch.

Steward identity surfaces **post-reveal** (the route loader returns a
`PublicListing` to non-owners; the verified shape — with the steward name —
comes back from `revealListingAddress`). Because the address policy is
orthogonal, the steward name and drop-off guidance only surface on stands that
also use `on_verified_request`; an approval-gated stand uses the inquiry flow,
whose email is stand-aware ("…wants to visit your produce stand").

## Reveal flow

A stand using `on_verified_request` shows a **single, generic** location CTA on
the public detail page — **"Show stand location"** (vs. "Show street address"
for a non-stand) — routing through the unchanged `revealListingAddress`. After
the reveal, a stand that accepts drop-offs shows the raw-whole-produce drop-off
guidance to **every** revealer (it's a stand property, not an intent). There is
no take/drop-off button split.

Unauthenticated viewers still hit the shipped `/login?returnTo=…` deep-link.

## Forms

On `/listings/new`, the stand is created simply by selecting **Produce stand**
in the existing produce-type picker. When that type is chosen the form
additionally shows a **Stand details** section that:

- offers an **Accept drop-offs** toggle (defaults on);
- shows the raw-whole-produce restriction copy and, when drop-offs are on,
  requires a ToS acknowledgment (`refineStandPreset`, keyed on the
  `produce-stand` type).

The `/listings/$id` owner-edit view shows the same **Stand details** section
(the drop-off toggle + restriction copy) whenever the listing's type is
`produce-stand`, persisting the toggle through the shipped `updateListing`
optimistic-save path.

The **address-release radio is always shown** and is an independent choice —
the stand type does not lock or normalize it.

## Browse surface

Stands get a distinct **map marker** using the Lucide **`Store`** icon, keyed
on `type === 'produce-stand'`. It reuses the shipped `ListingsMap`; only a
marker variant is added. The icon is a placeholder — `ShoppingBasket` is the
non-commercial alternative. A "stands only" filter is deferred.

A reusable **`DropOffIndicator`** surfaces whether a stand accepts drop-offs:
`arrow-right-left` + "Accepts drop-offs" or `arrow-right-from-line` + "Does not
accept drop-offs". A CSS container query collapses it to the icon alone
(accessible name carried by the wrapper's `role="img"` + `aria-label`, with a
matching `title` tooltip) in narrow slots and shows the icon beside the label in
wide ones — used as a corner chip on the listing card and as a "Drop-offs"
detail row on the listing page.

## Observability — delta only

The shipped 0009 reveal funnel is reused **unchanged** — no typed intent means
no new attributes, breadcrumbs, or fields. `listing.address.reveal.click`,
`listing.address.revealed`, and the Pino reveal log all behave exactly as they
did for a non-stand `on_verified_request` listing.

## Future work (separate issues)

- **`last_stocked_at` liquidity signal** — needs a dedicated signal captured at
  a confirmed drop-off, not inferred from a reveal click (see "No typed intent").
- **Drop-off suggestion** — remind owners of nearby stands N days after a
  non-stand listing is created.
- **Browse filters** — "stands only" and other listing filters.
- **Per-listing restrictions** — a `restrictions` table once there's a second
  value beyond raw-whole-produce.
