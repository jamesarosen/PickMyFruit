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

### 1. User donations (one-time and recurring)

- **What:** A "support the trees" link in the footer / post-rescue
  confirmation flow, powered by Stripe Checkout or Open Collective.
- **Why now:** Beta users who complete a successful rescue have peak
  goodwill. Capturing 2–5% at $5–25 covers infra for a long time at MVP
  scale.
- **Mission alignment:** High. Donations reinforce stewardship framing.
- **Drift risk:** Low — donors don't expect product changes.
- **Effort:** ~1 week (Stripe Payment Link is hours; Open Collective is
  zero-code but gives less control). Add a `donations` table only if we
  want on-site recognition.
- **First milestone:** Cover monthly Fly.io + Turso + Resend bills
  (~$30–60/mo) by month 4.

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

1. **Week 1–2:** Stand up a Stripe Payment Link or Open Collective page and
   add a footer "Support Pick My Fruit" link. Surface it on the
   post-rescue confirmation screen (highest-intent moment).
2. **Week 2–4:** Draft a one-page funder narrative (problem, traction,
   ask, budget). Submit to 3 grants — one local foundation, one
   food-rescue specific (ReFED), one civic-tech (Awesome Foundation).
3. **Month 2–3:** Add a `partners` listing page alongside gleaning-group
   support. Reach out to 5 local mission-aligned orgs; offer free
   placement to all, paid sponsorship to the 1–2 that have budget.
4. **Month 4:** Decide go / no-go on Tier‑2 white-label based on whether
   a second-city deployment request has surfaced organically.
5. **Quarterly:** Publish a transparency note — "$ in, $ out, pounds
   rescued." Reinforces stewardship value and feeds future grant
   narratives.

## Decision log

| Date       | Decision                         | Rationale                                |
| ---------- | -------------------------------- | ---------------------------------------- |
| 2026-05-24 | Draft initial revenue brainstorm | 365-day goal: "revenue model identified" |
