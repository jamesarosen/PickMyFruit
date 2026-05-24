# Revenue Opportunities

## Framing

Pick My Fruit is mission-first. The README states explicitly that "profit is
not a motive" and the project vision commits to a double bottom line —
**rescue the most food** and **feed the most people** — over a multi-decade
horizon. The 365-day goal in `CLAUDE.md` is "revenue model identified," not
"revenue maximized."

So "revenue" here means **sustainable funding**: enough money to cover
hosting, third-party services (Resend, Turso, S3, Sentry, domain),
operations, and eventually a part-time steward — while staying within the
mission. The SWOT in `0000-project-vision.md` calls out **mission drift**
as an explicit threat when chasing revenue, so each opportunity below is
graded on that risk.

## Evaluation criteria

For each opportunity, score on:

| Criterion             | Question                                                      |
| --------------------- | ------------------------------------------------------------- |
| Mission alignment     | Does this make rescue/feeding easier, or compete with it?     |
| Drift risk            | Does it bend the product toward paying users vs. the mission? |
| Effort to first $     | How much engineering / ops to ship a viable version?          |
| Recurring vs. one-off | Operating costs are recurring; ideally funding is too.        |
| Reversibility         | If it underperforms, can we kill it without harming users?    |

## Portfolio approach

Per the operating principle "think in portfolios — try a few, eliminate
losers, invest in winners," the recommendation is to run **two Tier‑1 bets
in parallel** alongside MVP work, defer Tier‑2 until traction data exists,
and treat Tier‑3 / red‑flag items as explicit "no, and here's why."

## Tier 1 — Pursue in the next 90 days

These are low-effort, high-alignment, and reversible. They're appropriate
to start while still in beta because they reinforce the mission narrative
rather than distort it.

### 1. User donations (one-time and recurring) — **shipped**

Shipped as the Support-Us flow in commit `cf71cffa` (PR #253): `/support`
page, header + footer links, `/support/go` 302 to Buy Me a Coffee with
server-side click counting, and a support block in the inquiry-received
email. Telemetry via Sentry counters (`support.view`, `support.go.click`).

Open follow-ups carried from that PR's "Future Work":

- `/about` page
- Public supporters list on `/support`
- "Welcome" email (delayed) with support block
- "Inquiry sent" email to picker with support block
- "Did you connect?" follow-up email with support block

Revenue milestone unchanged: cover monthly Fly.io + Turso + Resend bills
(~$30–60/mo) by month 4. Re-evaluate the channel choice (BMAC vs.
Stripe / Open Collective) once we have 3 months of conversion data.

### 2. Aligned grants

- **What:** Apply to food-rescue, climate, and civic-tech grant programs.
  Concrete targets: ReFED Catalytic Grants, Awesome Foundation local
  chapters, Patagonia Action Works, USDA Community Food Projects, local
  community foundations in launch cities.
- **Why now:** Grants reward exactly what we're already building
  (measurable food rescued, open source, community infrastructure). Most
  small grants don't require 501(c)(3) status; fiscal sponsorship via
  Open Collective Foundation or Hack Club Bank unlocks the rest.
- **Mission alignment:** Perfect — funders pick us _because_ of the mission.
- **Drift risk:** Low-to-moderate. Risk is over-promising on metrics in
  proposals; mitigate by only reporting what we already measure.
- **Effort:** ~2 days per application; first three applications in a
  weekend if we draft a reusable narrative.
- **Prerequisite:** Track and publish "pounds rescued" and "successful
  matches" metrics — already implied by the 30/60/90-day goals.

### 3. Mission-aligned local partnerships (sponsored placements, not ads)

- **What:** Free-or-paid placement on the site for orgs whose work
  complements ours: local food banks, gleaning nonprofits (e.g.
  Food Forward, Village Harvest), master gardener programs, tool libraries,
  community fridges. "Sponsored" means a small annual fee ($100–500) for
  partners that _can_ pay; free for those that can't.
- **Why now:** We will list these orgs anyway as part of the gleaning
  group work (60-day goal). Letting some pay is incremental.
- **Mission alignment:** High — these are the orgs we want users to know about.
- **Drift risk:** Moderate. Mitigate with a published partner policy:
  "we never accept money to surface a partner above a more relevant one."
- **Effort:** ~1 week for a `partners` schema and `/partners` route;
  most cost is in outreach, not engineering.

## Tier 2 — Pursue after MVP traction (months 4–12)

These require either user volume or a second user segment, both of which
the 60- and 90-day goals create.

### 4. White-label / hosted licensing to gleaning orgs and food banks

- **What:** Other cities' food-rescue orgs run Pick My Fruit on their own
  subdomain (`portland.pickmyfruit.com`) with their own branding, but we
  operate the infrastructure. They pay a flat $50–200/mo to cover hosting
  - a margin that funds development.
- **Why later:** Needs proven multi-city architecture (180-day goal) and
  at least one reference deployment.
- **Mission alignment:** High — this _is_ the multi-city expansion goal
  with funding attached.
- **Drift risk:** Low if priced as cost-recovery, not profit.
- **Open source angle:** Code stays Apache-2.0; orgs can self-host for free.
  We charge for the operational service, not the bits — preserves the
  community-software promise in the README.

### 5. Premium org tools (gleaning group dashboard, food-bank intake)

- **What:** Free for individual gardeners forever. Paid tier for organized
  groups: bulk scheduling, volunteer rosters, pickup logistics, intake
  receipts for food banks. $25–100/mo per org.
- **Why later:** The 60-day gleaning-group goal creates the user segment.
  Don't build before there are 3+ orgs asking for these features.
- **Drift risk:** Moderate. Risk that org features get prioritized over
  individual UX. Mitigate by requiring every premium feature to also
  benefit the free tier indirectly (e.g. better matching benefits everyone).

### 6. Workshops and harvest events

- **What:** Ticketed canning, pruning, and grafting classes co-hosted with
  master gardeners or extension offices. $10–40/seat; venue partnership
  keeps overhead near zero.
- **Mission alignment:** High — directly improves users' ability to
  preserve and use rescued fruit.
- **Drift risk:** Low. This is community-building.
- **Effort:** Eventbrite + a `/events` route; ~3 days.

### 7. Municipal / utility partnerships

- **What:** A city or water district pays a flat annual fee to deploy
  Pick My Fruit as part of a food-waste-reduction or urban-forestry
  program. Often tied to existing city green-bin or
  master-gardener budgets.
- **Why later:** Requires a track record and a launch-city case study.
  Sales cycle is 6–18 months; start outreach in month 6 to land in month 12+.
- **Mission alignment:** High — embeds us in civic infrastructure, which
  is the "build for permanence" piece of Practical Urgency.

### 12. Hyper-local flavor partners (small food & beverage businesses)

- **What:** Small food businesses — independent ice cream shops,
  bakeries, cocktail bars, jam makers, coffee roasters — source seasonal
  produce from Pick My Fruit listings to anchor a hyper-local product
  story. Think "Pick My Fruit Punch" sorbet or a "Neighborhood Tarte"
  pastry made from a 4-block radius of backyard plums.
- **Why later:** Needs (a) listing density per neighborhood to give a
  business a usable pipeline, (b) at least one pilot to validate the
  match-making mechanics, and (c) a clear policy on how this coexists
  with feeding-the-most-people. All three are 6–12 month items.
- **Why it fits:** Aligns directly with "Abundance Through Connection" —
  hyperlocal flavor is the _retail-facing_ expression of that value.
  Also creates a willingness-to-pay segment without paywalling anything
  for individuals.
- **Drift risk:** Moderate-to-high if handled naively; manageable with
  the priority-ladder and opt-in design described in the deep-dive
  section below.
- See
  [§ Deep-dive: hyper-local flavor partners](#deep-dive-hyper-local-flavor-partners)
  for the full exploration.

## Tier 3 — Watch and evaluate (12+ months)

Plausible but each carries enough drift risk or operational complexity to
defer until we have stable Tier‑1/2 income to fall back on.

### 8. Aggregated, anonymized food-waste data

- **What:** Sell or freely publish reports to researchers, cities, and
  food-policy orgs: "X tons of fruit rescued by zip code, Y% by tree species."
- **Drift risk:** High if sold to commercial buyers — users gave us data to
  share fruit, not to fuel analytics. **Recommendation: publish openly
  and pursue grants on the back of it** rather than monetize directly.

### 9. Affiliate links (pruning tools, canning supplies, fruit pickers)

- **What:** Curated Amazon / specialty-retailer links in pruning and
  canning guides; small affiliate commission.
- **Drift risk:** Moderate — affiliate revenue subtly biases content
  toward "buy more stuff." Acceptable only if the recommendation would
  exist without the link.

### 10. Carbon / methane-avoided credits

- **What:** Each pound of fruit diverted from landfill has a quantifiable
  methane-avoidance value. Voluntary carbon markets occasionally buy such
  credits.
- **Why deferred:** Verification overhead (MRV — measurement, reporting,
  verification) is significant relative to credit price at MVP scale.
  Revisit once annual rescues are in the tens of thousands of pounds.

### 11. Branded merch

- **What:** Tote bags, harvest aprons, "Blessed are those who plant trees"
  shirts (the project motto).
- **Realistic revenue:** Low — merch funds itself plus a small surplus.
  **Better positioned as a community / donor-thank-you item than a revenue
  line.**

## Red flags — explicit "no"

Documenting these so a future contributor doesn't reopen them without cause:

- **Display ads from third-party networks (AdSense, etc.).** Misaligns
  incentives toward page views over successful rescues. Degrades trust.
- **Paywalling core listings or inquiries.** Breaks the mission. Anyone
  who wants to share or claim fruit must be able to, free, forever.
- **Selling individual user data, addresses, or contact info.** Listing
  addresses are public-by-consent for fruit-sharing; that consent does
  not extend to commercial resale.
- **"Premium" placement for paying gardeners over others.** Same drift
  risk as ads with extra trust damage.

## Recommended next actions

In priority order, achievable inside the 30/60/90-day plan:

1. **Done (May 2026):** Donations channel live via `/support` → Buy Me a
   Coffee (PR #253). Next: complete the email-block follow-ups listed in
   §1 above and review BMAC vs. Stripe/Open Collective after 3 months of
   conversion data.
2. **Week 2–4:** Draft a one-page funder narrative (problem, traction,
   ask, budget). Submit to 3 grants — one local foundation, one
   food-rescue specific (ReFED), one civic-tech (Awesome Foundation).
3. **Month 2–3:** Add a `partners` listing page alongside gleaning-group
   support. Reach out to 5 local mission-aligned orgs; offer free
   placement to all, paid sponsorship to the 1–2 that have budget.
4. **Month 4:** Decide go / no-go on Tier‑2 white-label based on whether
   a second-city deployment request has surfaced organically.
5. **Month 4–5 (flavor-partner pilot):** Recruit 1–2 friendly Napa
   businesses (one bakery, one ice cream or cocktail program) for a
   single-season manual pilot. See deep-dive § "Pilot plan" for the
   no-product-changes script.
6. **Quarterly:** Publish a transparency note — "$ in, $ out, pounds
   rescued." Reinforces stewardship value and feeds future grant
   narratives.

## Deep-dive: hyper-local flavor partners

### The hypothesis

There is a small but real segment of food-and-beverage businesses whose
entire identity depends on being more local, more seasonal, and more
"story-driven" than the chain alternative. They will pay a modest fee
for reliable access to backyard produce because:

1. **It anchors their marketing.** "Made from plums picked within a
   half-mile of this counter" is a story that costs nothing to tell and
   that no national brand can match.
2. **It costs less than wholesale produce.** Backyard surplus is
   typically free or trade-for-product. Even allowing for pickup labor,
   it is cheaper than a wholesale produce account for the specialty
   varieties that are interesting enough to anchor a flavor.
3. **It de-risks experimentation.** A flavor of the week or a seasonal
   special is a small batch. A bushel of homeowner Meyer lemons is
   exactly the right scale; a pallet from a distributor is not.

### Why this fits the mission (and where it doesn't)

| Bottom-line goal             | Fit                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| Rescue the most food         | **Strong.** Businesses can absorb volumes (a bushel of plums) that overwhelm a single household.          |
| Make productive use of food  | **Strong.** Commercial processing extends shelf life; a tart sells for a week, a fresh plum lasts 3 days. |
| Feed the most people         | **Mixed.** A pastry feeds someone, but it's transactional rather than mutual-aid.                         |
| Multi-decade time horizon    | **Strong.** Embeds the platform in durable local-food economies.                                          |
| Abundance Through Connection | **Strong.** Connects gardeners to neighborhood institutions, not just other gardeners.                    |

The mixed row is the one that requires deliberate design. The mitigation
is structural, not aspirational — see "Priority ladder" below.

### Target segments (ranked by goodness-of-fit)

1. **Independent bakeries & pastry shops.** Already organized around
   seasonal specials; staff can process fruit on-site; one good
   relationship turns into year-round orders.
2. **Independent ice cream / gelato / sorbet shops.** Flavor-of-the-week
   is a structural part of the business; small batches; freezable, so
   timing flexibility is high.
3. **Cocktail bars with craft programs.** Bartenders actively seek
   unusual seasonal ingredients; small volumes per drink; high
   willingness-to-pay for novelty.
4. **Coffee roasters with house syrups.** Similar to cocktail bars at
   lower volumes.
5. **Cottage-industry jam, preserves, hot sauce, and ferment makers.**
   Lower margin per unit, but the highest volume absorption.
6. **Restaurants with seasonal "garden" menus.** Slowest to onboard
   (chef-driven, idiosyncratic) but highest reputational halo.

Deprioritized: caterers (event-driven, hard to forecast), grocery
delis (procurement systems can't absorb irregular supply), national or
regional chains (incompatible with the entire premise).

### Revenue model options

Listed from least to most product/operational complexity:

| Model                  | How it works                                                                          | Pros                                                      | Cons                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| **A. Annual sponsor**  | Business pays a flat annual fee ($200–500) to appear in a "Local flavor partner" list | Zero per-transaction friction; predictable revenue        | No volume signal; freeloading risk if listings are abundant                |
| **B. Subscription**    | Monthly fee ($25–50/mo) for a commercial dashboard, alerts, "looking for X" posts     | Aligns price with usage intensity; recurring              | Needs real product work; churn risk if a season is quiet                   |
| **C. Per-match fee**   | Pay $5–15 when a business successfully picks up from a listing                        | Pay-for-value; easy to justify                            | Disputes over what counts as a "match"; tracking overhead                  |
| **D. Branded license** | Businesses pay to use the "Made with Pick My Fruit" mark on packaging                 | Pure marketing play; tiny ops cost                        | Requires a recognizable brand we don't yet have                            |
| **E. Logistics fee**   | PMF (or a contractor) harvests and delivers; charge for the labor                     | Solves the real bottleneck (picking and moving the fruit) | Operational; insurance; food-safety; not a software business at this point |

**Recommended primary:** **(A) Annual sponsor** as the pilot model
because it has the smallest product surface and lets us validate
willingness-to-pay before we build anything new. Layer **(B)
subscription** on top in year two once we know what features the segment
actually uses. Treat **(E) logistics** as a "no" for now — it's a
different business.

### Pricing rationale

Indie-bakery / ice-cream P&Ls in a town like Napa typically have a few
hundred dollars per month earmarked for marketing line items (flyers,
sandwich-board, Instagram boosts). A $25–40/month or $250–400/year
sponsorship slots cleanly into that budget, especially when paired with a
storefront window cling and a "neighborhood map" of contributing
gardeners.

Pricing should be transparent and uniform — not negotiated — both to
stay close to the cooperative ethos and to avoid the founder spending
all their time selling.

### Product features (build only if pilot succeeds)

Listed in the order they'd be built. Each row is a discrete shippable
unit; do not pre-build.

1. **A "commercial use OK" flag on listings.** Owner explicitly opts in;
   default is off. Stored alongside existing listing status.
2. **A `partners` table with a `type` of `flavor`.** Reuses the schema
   from § 3 (mission-aligned partners); same `/partners` route.
3. **A "looking for X this week" reverse-listing post type.** Businesses
   say "we need 30 lb of stone fruit Friday"; gardeners can respond.
4. **Volume + variety filters.** Bakeries want 30 Meyer lemons, not 3
   mixed citrus. Variety field already exists; add a quantity normalizer
   above the free-text `quantity` field.
5. **Alerts.** Email/SMS to a business when an opt-in listing matches
   their saved query.
6. **A marketing kit.** Logo lockup, window cling PDF, social-media
   templates. Reduces per-partner support cost.

Critically: **steps 1–2 are enough for an annual-sponsor pilot.**
Everything from 3 onward should be gated on demand from at least three
paying partners.

### Priority ladder (mission protection)

This is the structural mitigation for the drift risk noted in the SWOT.

When a new listing is created with "commercial use OK" enabled, the
listing is still visible to **everyone** first. Commercial buyers see it
through the same UI as anyone else, with no priority signal. The
priority ladder is in our marketing and partner agreements, not in the
software:

- Day 0 → today: any neighbor or org can claim a listing as they do now.
- We **publish** the policy that commercial use is opt-in and never
  prioritized.
- Partner agreements forbid soliciting gardeners to switch listings to
  commercial-only.
- If a listing is claimed by an individual or food bank before a
  business picks it up, that claim wins, period.

Why no software-enforced delay? Because food rots. A two-day "neighbors
first" hold would destroy more food than it rescues. The mission
protection is the **opt-in default and the published policy**, not a
timer.

### Drift-risk register

| Risk                                                                  | Mitigation                                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Businesses price out food banks                                       | Commercial use is opt-in; food banks and individuals see the same listings at the same time                                      |
| Gardeners start asking for money                                      | Listings stay free-by-default; "commercial use OK" does not mean "for sale." Cash is between gardener and business, off-platform |
| Platform fee distorts to "more commercial = more revenue"             | Pricing is flat annual / flat monthly, not per-transaction. Founder compensation never tied to commercial GMV                    |
| Food-safety / liability when a business sells products from PMF fruit | TOS clarifies PMF is not party to the transaction; business is responsible for its own food-safety compliance                    |
| "Sponsored placement" creep                                           | Partners listed alphabetically or by neighborhood, never by spend. Documented in the partner policy                              |
| Mission narrative dilution                                            | Annual transparency report includes "% rescues that went commercial" with a self-imposed cap to revisit (suggested: 25%)         |

### Legal & operational notes

- **Cottage food / cottage industry laws** vary by state. California
  (where Napa launches) has a Cottage Food Operation program; this is
  mostly the business's problem, not ours, but worth linking in the
  partner kit.
- **Sales tax** is again the business's responsibility — we do not
  process commercial transactions.
- **Donation receipts** are not applicable to commercial pickups; we
  should be careful not to imply they are.
- **Insurance:** confirm with the platform GL policy that listing
  visibility to commercial buyers does not change coverage. If it does,
  cost may need to be passed through to partner fees.

### Pilot plan (zero new product features)

The cheapest validation:

1. **Recruit 2 businesses** in Napa — one bakery, one ice cream shop or
   cocktail program. Personal outreach by the founder.
2. **Pre-sell** a $250 annual sponsorship covering one harvest season,
   refundable if fewer than 3 successful pickups occur.
3. **Manually broker** matches: when a relevant listing appears, founder
   emails the business directly. Track every match in a spreadsheet.
4. **Co-produce one signature product per partner** — the "Pick My
   Fruit Punch" or "Neighborhood Tarte" — explicitly named to validate
   the marketing premise.
5. **Document outcomes:** pickups, pounds, partner satisfaction,
   gardener reaction, mission-fit qualitative notes.
6. **Decision gate (end of season):** if both partners renew at $250+
   _and_ the mission-fit notes are positive, build features 1–2 above
   and open the program to 10 partners the following year.

Total platform engineering cost of the pilot: **zero**. Total founder
time: ~1 day/week during one harvest season.

### Open questions to revisit before pilot

- Who carries food-safety liability when a tree owner doesn't know their
  fruit has been sprayed?
- Does the launch city's homeowner-association or zoning landscape
  treat commercial pickup of homeowner produce differently from
  neighborly gleaning?
- Should "commercial use OK" be a per-listing flag or a per-user
  default? Per-listing is more flexible; per-user is less friction.
- Is there a clean way for gardeners to receive in-kind compensation
  (a free pastry, a jar of jam) without it constituting a "sale" for
  tax purposes?

## Decision log

| Date       | Decision                                                                                          | Rationale                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 2026-05-24 | Draft initial revenue brainstorm                                                                  | 365-day goal: "revenue model identified"                                                                             |
| 2026-05-24 | Mark §1 (donations) as shipped; add §12 (hyper-local flavor partners) deep-dive and pilot to plan | Donations shipped in PR #253 (commit `cf71cffa`); flavor-partner avenue identified from user/community conversations |
