# Roadmap: Path to 10 Beta Users

**Goal**: Get the platform live, collect real user data, and iterate rapidly
**Target**: 10 beta users with 3 successful gatherings

> **Terminology**: See [terminology.md](terminology.md) for domain model naming decisions.
>
> - **ProduceType** (`/produce/*`): Canonical category (e.g., "Rangpur Lime")
> - **Listing** (`/listings/*`): A specific shareable source (e.g., "James's lime tree in Napa")
> - **Gathering**: A completed transfer

---

# Now

## PR #7: Add Simple Contact/Claim Flow (Gatherings)

**Size**: Medium (~150 lines)
**Impact**: HIGH - enables gatherings

**Changes**:

- Add "Contact Owner" button on listing cards
- Create contact form that sends email to owner
- Add status update: available → pending → gathered
- Owner receives email with gleaner contact info
- Simple email templates (text-based, no fancy HTML)
- Log all contact attempts as Gathering records

**Why Now**: Completes the core loop. Users can now create listings AND be contacted by gleaners. This enables our first successful gatherings.

**Reasoning**: Manual matching is fine for 10 users, but we need a way to track that someone is claiming produce. A simple "send email to owner" flow with status tracking is sufficient. Avoids complex authentication or messaging systems.

**Alternative Considered**: SMS via Twilio. Email is simpler and doesn't require paid service initially.

**Review Focus**: Email deliverability, privacy protection, spam prevention

---

# Next

## PR #8: Add Developer Tools - Testing Infrastructure

**Size**: Medium (~200 lines)
**Impact**: MEDIUM - improves iteration speed

**Changes**:

- Add Vitest configuration (already in tech stack)
- Write tests for database queries
- Write tests for form validation
- Write tests for API endpoints
- Add test:watch script
- Add code coverage reporting
- Update CI to run tests

**Reasoning**: The tech stack specifies Vitest (CLAUDE.md:8) but no tests exist yet. Testing after building core features (rather than TDD) is pragmatic for rapid MVP development, but we need tests before adding complexity.

**Review Focus**: Test coverage of critical paths, test performance

---

## PR #9: Add Monitoring and Admin Dashboard

**Size**: Medium (~150 lines)
**Impact**: MEDIUM - enables data-driven decisions

**Changes**:

- Add simple analytics: listings created, contacts made, gatherings completed
- Create /admin route with basic auth
- Show key metrics dashboard
- Add user feedback form ("How did it go?")
- Log page views and user flows
- Add error tracking (could use Sentry free tier)

**Reasoning**: At this stage (goal: 10 beta users, 3 gatherings), we need visibility into the funnel. Where do users drop off? Are listings being contacted? Are gatherings completed? Manual tracking doesn't scale past 5 users.

**Review Focus**: Privacy compliance, performance impact of logging

---

## UX Polish: Listing Form & Login Flow

**Size**: Small (~50 lines)
**Impact**: LOW - improves user experience

**Changes**:

- Add "View My Listings" link to the listing creation success message
- Show contextual message on login page when redirected from a protected route (e.g., "Sign in to list your fruit tree" when `returnTo=/listings/new`)
- Normalize timestamp columns: align `listings.created_at`/`updated_at` to `timestamp_ms` (milliseconds) to match Better Auth tables

**Reasoning**: Small UX gaps identified during the owners-table removal refactor. None are blockers but they improve the feel of the auth-first listing flow.

---

# Later

## PR #10: Add Local Development Seed Data & Documentation

**Size**: Small (~120 lines)
**Impact**: MEDIUM - improves Claude and human DX

**Changes**:

- Enhance existing seed.ts with realistic data
- Add pnpm dev:seed script for quick reset
- Document local development setup in README
- Add troubleshooting guide
- Document common Claude Code workflows
- Add API endpoint documentation

**Reasoning**: Makes it easier for Claude (and potential contributors) to work on the codebase. Fast local development = fast iteration.

**Review Focus**: Documentation accuracy, seed data quality

---

## PR #11: Add Progressive Web App (PWA) Capabilities

**Size**: Small (~100 lines)
**Impact**: LOW (nice-to-have) - improves mobile UX

**Changes**:

- Add service worker for offline capabilities
- Add web app manifest
- Enable "Add to Home Screen" on mobile
- Cache static assets
- Add offline fallback page
- Test on iOS Safari and Android Chrome

**Reasoning**: Gardeners are often outside, on mobile, with spotty connectivity. PWA makes the site feel more app-like and work offline. This is the only PR that's purely nice-to-have.

**Review Focus**: Offline behavior, cache invalidation strategy

---

## Future Enhancements

- **Address privacy preview**: Add interactive map preview to the listing form showing the H3 cell at resolution 9 (~174m). Users would see the hexagonal area that gleaners will see, reinforcing the privacy message. Requires adding a mapping library (Leaflet recommended - free, no API key).
- **Fruit type autocomplete with varieties**: Replace the fruit type dropdown with an autocomplete search that includes varieties (e.g., "Apple - Honeycrisp", "Lemon - Meyer"). This provides better categorization without adding a separate variety field.
- **Rate-limit magic link resend buttons**: Add debounce/cooldown to "Resend email" buttons on login page and listing form to prevent abuse and avoid hitting Resend API rate limits.
- **Server-side pending listings**: Store unconfirmed listings and user state in the database instead of sessionStorage. This preserves form data if user opens magic link in a different browser/tab. Add `status: 'pending_verification' | 'active'` to listings and clean up unverified listings after 24 hours.
- **Owner view of private listings**: Allow owners to view their own private listings on the detail page. Pass session context through the loader so `getPublicListingById` can include private listings owned by the requesting user. (flagged during listing-status review)

---

## What We're Explicitly NOT Building (Yet)

1. **Search/filtering** - Not needed for 10 users in one city
2. **Map view** - Nice-to-have, not critical for MVP
3. **Ratings/reviews** - Adds complexity, not needed for trust at small scale
4. **Gleaner profiles** - Manual matching is sufficient
5. **Push notifications** - Email is enough
6. **Advanced scheduling** - Coordinate via email/text
7. **Photo uploads** - Adds complexity, not needed to prove value
8. **Multi-language support** - English only for Napa, CA

These features might be valuable later, but they don't help us reach 10 beta users or 3 successful gatherings. Ship minimal, learn fast, iterate based on real user needs.

---

# Completed

## ✅ PR #1: SSR with SQLite Persistence

**Size**: Small (~100 lines) | **Impact**: HIGH - enables read+write app architecture

Created Dockerfile for Node.js + SQLite deployment, configured Vite for SSR, added health check endpoint.

---

## ✅ PR #2: Deploy to Fly.io with SQLite Persistence

**Size**: Small (~100 lines) | **Impact**: HIGH - enables production feedback loop

Added fly.toml configuration with persistent volume for SQLite, updated package.json with production build scripts.

---

## ✅ PR #3: Connect Real SQLite Database via SSR API Routes

**Size**: Small (~80 lines) | **Impact**: HIGH - enables data persistence

Added Vinxi/Solid-Start API routes, wired up schema.ts to real database queries, replaced mock data with real DB calls, added database migrations script.

---

## ✅ PR #4: Add CI/CD Pipeline with GitHub Actions

**Size**: Small (~60 lines) | **Impact**: HIGH - enables rapid iteration

Expanded GitHub Actions workflow with deployment step to Fly.io on main branch push.

---

## ✅ PR #5: Add Listing Form with Validation

**Size**: Medium (~200 lines) | **Impact**: CRITICAL - enables user-generated content

Created `/listings/new` route, built form with Zod validation, added geocoding via Nominatim API, generates H3 index from coordinates.

---

## ✅ PR #6: Add Basic Authentication with Better Auth

**Size**: Medium (~180 lines) | **Impact**: MEDIUM - improves trust and accountability

Configured Better Auth with magic link authentication via Resend, linked listings to authenticated users, added "My Listings" page.

---

# Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Geocoding API rate limits | Use free Nominatim (rate-limited but sufficient for MVP), cache results, add fallback to manual lat/lng entry |
| Email deliverability issues | Start with transactional email service (Resend free tier), add SPF/DKIM records, monitor bounce rates |
| SQLite write concurrency on Fly.io | SQLite handles this well for < 1000 users. Monitor, plan migration to Turso (LibSQL) if needed |
| Spam submissions | Start with simple rate limiting, add Cloudflare Turnstile (free) if spam becomes an issue |
| Poor mobile UX | Mobile-first CSS already in use. PWA (Later) further improves mobile experience |

---

# Open Questions

1. **Email service**: Use SendGrid free tier, Postmark, or AWS SES?
2. **Error monitoring**: Sentry free tier sufficient, or use another service?
3. **Geocoding**: Nominatim (free, rate-limited) or pay for Google Maps Geocoding?
4. **Domain name**: What domain should we deploy to?

---

# Success Metrics

After completing Now and Next:

- ✅ Platform deployed and live
- ✅ Users can create listings
- ✅ Users can contact/claim produce (gatherings)
- ✅ Users can manage their listings
- ✅ Manual matching works
- ✅ Fast iteration cycle (< 5 minutes to deploy)
- ✅ Monitoring shows conversion funnel
- ✅ Developer experience enables Claude to iterate quickly

**Measurable Outcomes**:

- Deploy time: push to production in < 5 minutes
- Form completion: > 70% of users who start the form finish it
- Time to first listing: < 2 minutes from landing page
- Response time: owners contacted within 24 hours
- Iteration speed: bug fix deployed in < 10 minutes

---

# References

- Bastow, [Why I Invented the Now-Next-Later Roadmap](https://www.prodpad.com/blog/invented-now-next-later-roadmap/)
- Gonzalez de Villaumbrosia, [Curves Ahead: Navigating Change with Now-Next-Later Roadmap](https://productschool.com/blog/product-strategy/now-next-later-roadmap)
- Mee, [Why “Now” “Next” “Later” is one of the best frameworks for roadmapping](https://medium.com/the-product-innovator/why-now-next-later-is-one-of-the-best-frameworks-for-roadmapping-4d547a2f2692)
