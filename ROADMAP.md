# Roadmap: Path to 10 Beta Users

**Updated**: 2026-01-08
**Goal**: Get the platform live, collect real user data, and iterate rapidly
**Target**: 10 beta users with 3 successful gatherings

> **Terminology**: See [docs/terminology.md](docs/terminology.md) for domain model naming decisions.
> - **ProduceType** (`/produce/*`): Canonical category (e.g., "Rangpur Lime")
> - **Listing** (`/garden/*`): A specific shareable source (e.g., "James's lime tree in Napa")
> - **Gathering**: A completed transfer

## Strategic Reasoning

### Critical Challenges to Common Assumptions

1. **Challenge: "We need complete authentication first"**
   - Reality: For 10 beta users, passwordless auth or even just email collection is sufficient
   - Start with minimal auth, add complexity only when proven necessary

2. **Challenge: "We need to build both sides of the marketplace"**
   - Reality: Manual matching is fine for MVP. Focus on fruit owners first.
   - Gleaner discovery/claiming can be handled via text/email initially

3. **Challenge: "We need perfect features before launch"**
   - Reality: A working, deployed form beats a perfect local feature
   - Ship minimal, iterate based on real user feedback

4. **Challenge: "Developer experience isn't a feature"**
   - Reality: Slow iteration = death. Fast CI/CD and good DX = rapid learning
   - Every hour saved in deployment is an hour spent with users

### Sequencing Philosophy

**Phase 1 (PRs 1-4)**: Ship to Production
- Deploy infrastructure and real database first
- Get something live, even if incomplete
- Enable real-world testing immediately

**Phase 2 (PRs 5-7)**: Core User Flows
- Add listing form (user-generated content)
- Add basic contact/claim mechanism (gatherings)
- Validate the core value proposition

**Phase 3 (PRs 8-11)**: Iterate Faster
- Improve developer experience for rapid iteration
- Add monitoring and feedback loops
- Prepare for scaling insights

---

## Pull Request Plan

### ✅ PR #1: SSR with SQLite Persistence

**Size**: Small (~100 lines)
**Impact**: HIGH - enables read+write app architecture

**Changes**:
- Create Dockerfile for Node.js + SQLite deployment
- Configure Vite for SSR (server-side rendering)
- Add health check endpoint

**Why First**: This unblocks everything else. SSR means we can use real SQLite on the server instead of mocking data in the browser.

**Reasoning**: The current codebase uses mock data because "we can't run SQLite in the browser" (apps/www/src/api/plants.ts:2). This is backwards. We should deploy with SSR so we can use real SQLite server-side.

**Review Focus**: Dockerfile security, volume mounting, health checks

---

### ✅ PR #2: Deploy to Fly.io with SQLite Persistence

**Size**: Small (~100 lines)
**Impact**: HIGH - enables production feedback loop

**Changes**:
- Add fly.toml configuration with persistent volume for SQLite
- Update package.json with production build scripts

**Why First**: Can't get users without deployment.

**Reasoning**: The current codebase uses mock data because "we can't run SQLite in the browser" (apps/www/src/api/plants.ts:2). This is backwards. We should deploy with SSR so we can use real SQLite server-side. Fly.io makes this trivial with persistent volumes.

**Review Focus**: Volume mounting, health checks

---

### ✅ PR #3: Connect Real SQLite Database via SSR API Routes

**Size**: Small (~80 lines)
**Impact**: HIGH - enables data persistence

**Changes**:
- Add Vinxi/Solid-Start API routes (or alternative SSR framework)
- Wire up existing schema.ts to real database queries
- Replace mock data in api/plants.ts with real DB calls
- Add database migrations script
- Add connection pooling and error handling

**Why Second**: Now that we can deploy with SSR, connect the real database. This enables user-generated content (next PR).

**Reasoning**: The foundation (schema, queries) already exists. We just need to wire it up server-side. This is straightforward since we're already using Drizzle ORM.

**Review Focus**: Query performance, error handling, SQL injection protection

---

### PR #4: Add CI/CD Pipeline with GitHub Actions

**Size**: Small (~60 lines)
**Impact**: HIGH - enables rapid iteration

**Changes**:
- Expand existing GitHub Actions workflow (already has test & lint)
- Add deployment step to Fly.io on main branch push
- Add PR preview deployments (optional but valuable)
- Configure secrets for Fly.io API token
- Add deployment status checks

**Why Third**: Now that deployment works manually, automate it. Every commit to main should deploy automatically. This creates the fast feedback loop essential for iteration.

**Reasoning**: A workflow already exists (39e8b17). Extend it. Manual deployments slow us down and create friction. Automated deployment means we can ship fixes in minutes, not hours.

**Review Focus**: Security of secrets, deployment rollback strategy

---

### PR #5: Add Listing Form with Validation

**Size**: Medium (~200 lines)
**Impact**: CRITICAL - enables user-generated content

**Changes**:
- Create `/garden/new` route with TanStack Router
- Build form component with Solid JS
- Add Zod validation schema (matches schema.ts)
- Add geocoding via Nominatim API (free, no key required)
- Generate H3 index from coordinates
- Add form submission endpoint (creates a Listing)
- Show success/error states

**Why Fourth**: First feature that lets users DO something. This is the primary value prop: "List My Produce" button actually works now.

**Reasoning**: The homepage prominently features a "List My Fruit Tree" CTA (index.tsx:35, 60), but it doesn't do anything. This is the most critical gap preventing users from using the platform.

**Form Fields** (from schema):
- ProduceType selection (or free-text for unlisted types)
- Quantity estimate, harvest window
- Address (geocoded to lat/lng/H3)
- Owner name, email, phone
- Notes, access instructions

**Review Focus**: Input validation, geocoding error handling, privacy of contact info

---

### PR #6: Add Simple Contact/Claim Flow (Gatherings)

**Size**: Medium (~150 lines)
**Impact**: HIGH - enables gatherings

**Changes**:
- Add "Contact Owner" button on listing cards
- Create contact form that sends email to owner
- Add status update: available → pending → gathered
- Owner receives email with gleaner contact info
- Simple email templates (text-based, no fancy HTML)
- Log all contact attempts as Gathering records

**Why Fifth**: Completes the core loop. Users can now create listings AND be contacted by gleaners. This enables our first successful gatherings.

**Reasoning**: Manual matching is fine for 10 users, but we need a way to track that someone is claiming produce. A simple "send email to owner" flow with status tracking is sufficient. Avoids complex authentication or messaging systems.

**Alternative Considered**: SMS via Twilio. Email is simpler and doesn't require paid service initially.

**Review Focus**: Email deliverability, privacy protection, spam prevention

---

### PR #7: Add Basic Authentication with Better Auth

**Size**: Medium (~180 lines)
**Impact**: MEDIUM - improves trust and accountability

**Changes**:
- Install and configure Better Auth (already in CLAUDE.md as the chosen solution)
- Add magic link email authentication
- Create user table in schema
- Link listings to authenticated users
- Add "My Listings" page (`/garden`)
- Allow users to edit/delete their own listings only

**Why Sixth**: Now that we have core functionality working, add auth to improve trust. Users can manage their listings. This also enables us to track repeat users and gather metrics.

**Reasoning**: Better Auth is already specified in the tech stack (CLAUDE.md:9). Passwordless auth (magic links) has the lowest friction for non-technical users (elderly gardeners). Deferred until after core flows work to avoid complexity blocking launch.

**Review Focus**: Email security, session management, authorization checks

---

### PR #8: Add Developer Tools - Testing Infrastructure

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

**Why Seventh**: Now that we have real features, add tests to prevent regressions. This pays dividends as we iterate based on user feedback.

**Reasoning**: The tech stack specifies Vitest (CLAUDE.md:8) but no tests exist yet. Testing after building core features (rather than TDD) is pragmatic for rapid MVP development, but we need tests before adding complexity.

**Review Focus**: Test coverage of critical paths, test performance

---

### PR #9: Add Monitoring and Admin Dashboard

**Size**: Medium (~150 lines)
**Impact**: MEDIUM - enables data-driven decisions

**Changes**:
- Add simple analytics: listings created, contacts made, gatherings completed
- Create /admin route with basic auth
- Show key metrics dashboard
- Add user feedback form ("How did it go?")
- Log page views and user flows
- Add error tracking (could use Sentry free tier)

**Why Eighth**: We need to measure progress toward "3 successful gatherings." This enables us to see what's working and what's not.

**Reasoning**: At this stage (goal: 10 beta users, 3 gatherings), we need visibility into the funnel. Where do users drop off? Are listings being contacted? Are gatherings completed? Manual tracking doesn't scale past 5 users.

**Review Focus**: Privacy compliance, performance impact of logging

---

### PR #10: Add Local Development Seed Data & Documentation

**Size**: Small (~120 lines)
**Impact**: MEDIUM - improves Claude and human DX

**Changes**:
- Enhance existing seed.ts with realistic data
- Add pnpm dev:seed script for quick reset
- Document local development setup in README
- Add troubleshooting guide
- Document common Claude Code workflows
- Add API endpoint documentation

**Why Ninth**: Makes it easier for Claude (and potential contributors) to work on the codebase. Fast local development = fast iteration.

**Reasoning**: A seed script exists (package.json:19) but we need better documentation for Claude to work efficiently. The CLAUDE.md file is good but needs operational details (how to reset DB, how to test auth locally, etc.).

**Review Focus**: Documentation accuracy, seed data quality

---

### PR #11: Add Progressive Web App (PWA) Capabilities

**Size**: Small (~100 lines)
**Impact**: LOW (nice-to-have) - improves mobile UX

**Changes**:
- Add service worker for offline capabilities
- Add web app manifest
- Enable "Add to Home Screen" on mobile
- Cache static assets
- Add offline fallback page
- Test on iOS Safari and Android Chrome

**Why Tenth**: Gardeners are often outside, on mobile, with spotty connectivity. PWA makes the site feel more app-like and work offline. This is a quality-of-life improvement, not a blocker.

**Reasoning**: This is the only PR that's purely nice-to-have. However, given that the target users (gardeners) are likely to access the site on mobile while in their yards, PWA capabilities could significantly improve UX. It's also easy to implement with Vite.

**Review Focus**: Offline behavior, cache invalidation strategy

---

## PR Size Distribution

- Small (< 100 lines): 5 PRs
- Medium (100-200 lines): 6 PRs
- Large (200+ lines): 0 PRs

All PRs are human-reviewable in under 15 minutes.

---

## Success Metrics

After these 10 PRs:
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

## Risk Mitigation

**Risk**: Geocoding API rate limits
**Mitigation**: Use free Nominatim (rate-limited but sufficient for MVP), cache results, add fallback to manual lat/lng entry

**Risk**: Email deliverability issues
**Mitigation**: Start with transactional email service (SendGrid free tier), add SPF/DKIM records, monitor bounce rates

**Risk**: SQLite write concurrency on Fly.io
**Mitigation**: SQLite handles this well for < 1000 users. Monitor, plan migration to Turso (LibSQL) if needed

**Risk**: Spam submissions
**Mitigation**: Start with simple rate limiting, add Cloudflare Turnstile (free) if spam becomes an issue

**Risk**: Poor mobile UX (responsive design)
**Mitigation**: Mobile-first CSS already in use. PR #10 (PWA) further improves mobile experience

---

## Timeline Estimate

**Not including actual time estimates per your instructions**, but noting dependencies:
- PRs 1-3 can proceed in sequence (deploy → database → CI/CD)
- PRs 4-5 can proceed after PR 2 completes
- PR 6 can proceed after PR 5
- PRs 7-10 can proceed in parallel after PR 6

Critical path: PR 1 → PR 2 → PR 4 → PR 5 (core value delivery)
Parallel work: PR 3, PR 7, PR 8 can happen alongside feature development

---

## Alignment with Project Goals

From CLAUDE.md:
- **30 days (past due)**: MVP with 10 beta users - ✅ PRs 1-6 deliver this
- **60 days**: Gleaning group support - 🔄 Not in these 10 PRs (manual matching sufficient)
- **90 days (past due)**: Automation complete - ✅ PR 4 (CI/CD) enables this
- **180 days**: Expand to 2-3 cities - 🔮 Future work
- **365 days**: Revenue model - 🔮 Future work

These 11 PRs focus on the most critical gap: **getting to 10 beta users**. We're behind schedule (30-day goal has passed), so aggressive focus on core value delivery is essential.

---

## Open Questions for Discussion

1. **Email service**: Use SendGrid free tier, Postmark, or AWS SES?
2. **SSR framework**: Should we use Solid-Start, Vinxi, or something else for API routes?
3. **Error monitoring**: Sentry free tier sufficient, or use another service?
4. **Geocoding**: Nominatim (free, rate-limited) or pay for Google Maps Geocoding?
5. **Domain name**: What domain should we deploy to?

---

*This roadmap prioritizes shipping over perfection, learning over assumptions, and user value over feature bloat. Every PR is scoped to be reviewable by humans in under 15 minutes and independently deployable.*
