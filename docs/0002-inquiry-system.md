# PR #7: Inquiry System

## Summary

Add a system that lets gleaners express interest in fruit listings. When a gleaner clicks "Put me in touch," PMF emails the owner with the gleaner's contact info. Owners can mark listings as unavailable (visible but contact disabled) or private (hidden but shareable via URL).

**Note**: The database table is `plants` but URLs use `/listings/` for user-friendly semantics.

---

## Data Model Changes

### 1. Update `plants` table (`src/data/schema.ts`)

**Status field**: Change from `'available' | 'claimed' | 'harvested'` to `'active' | 'unavailable' | 'private'`

**Add fields**:
- `deletedAt: integer('deleted_at', { mode: 'timestamp' })` - soft delete

### 2. Add `inquiries` table (`src/data/schema.ts`)

```typescript
export const inquiries = sqliteTable('inquiries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  listingId: integer('listing_id').notNull().references(() => plants.id),
  gleanerId: text('gleaner_id').notNull().references(() => user.id),
  note: text('note'), // max 500 chars, validated at API layer
  emailSentAt: integer('email_sent_at', { mode: 'timestamp' }),
}, (table) => [
  index('inquiry_listing_id_idx').on(table.listingId),
  index('inquiry_gleaner_id_idx').on(table.gleanerId),
])

export type Inquiry = typeof inquiries.$inferSelect
export type NewInquiry = typeof inquiries.$inferInsert
```

### 3. Migration (`drizzle/0003_add_inquiries.sql`)

```sql
-- Update existing status values (must happen before query code changes)
UPDATE plants SET status = 'active' WHERE status = 'available';
UPDATE plants SET status = 'unavailable' WHERE status IN ('claimed', 'harvested');

-- Add soft delete column with index for efficient filtering
ALTER TABLE plants ADD COLUMN deleted_at integer;
CREATE INDEX plants_deleted_at_idx ON plants(deleted_at);

-- Create inquiries table
CREATE TABLE inquiries (
  id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  created_at integer DEFAULT (unixepoch()) NOT NULL,
  listing_id integer NOT NULL REFERENCES plants(id),
  gleaner_id text NOT NULL REFERENCES user(id),
  note text,
  email_sent_at integer
);
CREATE INDEX inquiry_listing_id_idx ON inquiries(listing_id);
CREATE INDEX inquiry_gleaner_id_idx ON inquiries(gleaner_id);
```

**Critical**: Run migration before deploying code changes. The migration updates status values so existing data works with new query filters.

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/email-templates.ts` | Inquiry email HTML builder |
| `src/lib/hmac.ts` | HMAC utilities for signed URLs |
| `src/routes/api/inquiries.ts` | POST /api/inquiries endpoint |
| `src/routes/api/listings.$id.ts` | PATCH /api/listings/:id |
| `src/routes/api/plants.$id.unavailable.ts` | GET one-click mark unavailable (with HMAC) |
| `src/routes/listings.$id.tsx` | Listing detail page |
| `src/routes/listings.css` | Listing detail styles |
| `src/components/InquiryForm.tsx` | "Put me in touch" form |
| `src/components/InquiryForm.css` | Form styles |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/data/schema.ts` | Add `inquiries` table, add `deletedAt` to plants, export types |
| `src/data/queries.ts` | Add inquiry queries, update status filter to `active`, add soft delete check |
| `src/lib/validation.ts` | Add `inquiryFormSchema`, `updateListingStatusSchema` |
| `src/routes/garden/mine.tsx` | Add status toggle button, update status badge classes |
| `src/routes/garden/mine.css` | Add styles for new status values and toggle button |
| `src/routes/index.tsx` | Make plant cards clickable links to `/listings/:id` |
| `src/routes/index.css` | Add hover/focus states for clickable cards |

---

## Query Functions (`src/data/queries.ts`)

### New Functions

```typescript
// Create an inquiry
export async function createInquiry(data: NewInquiry): Promise<Inquiry>

// Update emailSentAt after successful send
export async function markInquiryEmailSent(id: number): Promise<void>

// Check rate limit: has gleaner inquired on this listing in last 24h?
export async function hasRecentInquiry(gleanerId: string, listingId: number): Promise<boolean>

// Get listing with owner info for email
export async function getListingWithOwner(id: number): Promise<{
  listing: Plant
  owner: { id: string; name: string; email: string }
} | undefined>

// Get listing for inquiry validation (active or private, not deleted)
export async function getListingForInquiry(id: number): Promise<Plant | undefined>

// Update listing status (owner only)
export async function updateListingStatus(
  id: number,
  userId: string,
  status: 'active' | 'unavailable' | 'private'
): Promise<boolean>

// Get user by ID (for gleaner info in email)
export async function getUserById(id: string): Promise<{ name: string; email: string } | undefined>
```

### Modified Functions

```typescript
// Update to filter by 'active' status and exclude deleted
export async function getAvailablePlants(limit: number = 10): Promise<Plant[]> {
  return await db
    .select()
    .from(plants)
    .where(and(
      eq(plants.status, 'active'),
      isNull(plants.deletedAt)
    ))
    .orderBy(desc(plants.createdAt))
    .limit(limit)
}

// Update to exclude deleted listings
export async function getUserListings(userId: string): Promise<Plant[]> {
  return await db
    .select()
    .from(plants)
    .where(and(
      eq(plants.userId, userId),
      isNull(plants.deletedAt)
    ))
    .orderBy(desc(plants.createdAt))
}
```

---

## API Endpoints

### POST /api/inquiries

**Auth**: Required (gleaner must be logged in)

**Request Body**:
```typescript
interface InquiryRequest {
  listingId: number
  note?: string // max 500 chars
}
```

**Validation**:
1. Listing exists, is not deleted, and status is `active` or `private`
2. Gleaner is not the listing owner
3. Note is max 500 characters
4. **Rate limit**: No inquiry from this gleaner on this listing in last 24 hours

**Response** (201):
```typescript
interface InquiryResponse {
  success: true
  inquiryId: number
  emailSent: boolean // false if email failed but inquiry was recorded
}
```

**Error Responses**:
- 400: Invalid input, own listing, rate limit exceeded
- 401: Not authenticated
- 404: Listing not found or unavailable

**Email Handling**:
1. Create inquiry record with `emailSentAt: null`
2. Attempt to send email
3. On success: update `emailSentAt` to current timestamp
4. On failure: log error, return `emailSent: false` (inquiry still recorded)

---

### PATCH /api/listings/:id

**Auth**: Required (must be listing owner)

**Request Body**:
```typescript
interface ListingUpdateRequest {
  status: 'active' | 'unavailable' | 'private'
}
```

**Response** (200):
```typescript
interface ListingUpdateResponse {
  success: true
}
```

**Error Responses**:
- 400: Invalid status
- 401: Not authenticated
- 404: Listing not found or not authorized

---

### GET /api/plants/:id/unavailable

**Auth**: HMAC signature verification

**URL Format**:
```
/api/plants/:id/unavailable?nonce=abc123&sig=def456
```

**HMAC Signature**:
```typescript
// Generate (in email template)
const nonce = crypto.randomUUID()
const message = `${plantId}:${nonce}`
const sig = hmac(message, process.env.HMAC_SECRET)
const url = `/api/plants/${plantId}/unavailable?nonce=${nonce}&sig=${sig}`

// Verify (in endpoint)
const expectedSig = hmac(`${plantId}:${nonce}`, process.env.HMAC_SECRET)
if (sig !== expectedSig) return 403
```

**Action**: Mark listing unavailable, redirect to `/garden/mine?marked=unavailable`

**Error Responses**:
- 400: Missing nonce or sig
- 403: Invalid signature
- 404: Listing not found

---

## HMAC Utilities (`src/lib/hmac.ts`)

```typescript
import { createHmac } from 'crypto'

const HMAC_SECRET = process.env.HMAC_SECRET || 'dev-secret-change-in-prod'

export function signUrl(plantId: number): { nonce: string; sig: string } {
  const nonce = crypto.randomUUID()
  const message = `${plantId}:${nonce}`
  const sig = createHmac('sha256', HMAC_SECRET).update(message).digest('hex')
  return { nonce, sig }
}

export function verifySignature(plantId: number, nonce: string, sig: string): boolean {
  const message = `${plantId}:${nonce}`
  const expected = createHmac('sha256', HMAC_SECRET).update(message).digest('hex')
  // Timing-safe comparison
  return sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
}

export function buildUnavailableUrl(baseUrl: string, plantId: number): string {
  const { nonce, sig } = signUrl(plantId)
  return `${baseUrl}/api/plants/${plantId}/unavailable?nonce=${nonce}&sig=${sig}`
}
```

---

## Validation Schemas (`src/lib/validation.ts`)

```typescript
export const inquiryFormSchema = z.object({
  listingId: z.number().int().positive('Invalid listing'),
  note: z.preprocess(
    (val) => (val === '' || val === null ? undefined : val),
    z.string().max(500, 'Note must be 500 characters or less').optional()
  ),
})

export type InquiryFormData = z.infer<typeof inquiryFormSchema>

export const listingStatuses = ['active', 'unavailable', 'private'] as const
export type ListingStatus = (typeof listingStatuses)[number]

export const updateListingStatusSchema = z.object({
  status: z.enum(listingStatuses, { message: 'Invalid status' }),
})
```

---

## Inquiry Email Template

**Subject**: `{GleanerName} wants your {ProduceType}`

**From**: `Pick My Fruit <notifications@pickmyfruit.com>`

**Reply-To**: Gleaner's email address

**HTML Body** (matches magic link email styling from `src/lib/auth.ts`):

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h1 style="color: #2d5016; margin-bottom: 24px;">Someone wants your {produceType}!</h1>

  <p>Hi {ownerName},</p>

  <p><strong>{gleanerName}</strong> is interested in your {produceType}.</p>

  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <h3 style="margin: 0 0 12px 0; color: #2d5016;">Listing Details</h3>
    <p style="margin: 0 0 8px 0;"><strong>Type:</strong> {produceType}</p>
    {quantity && <p style="margin: 0 0 8px 0;"><strong>Quantity:</strong> {quantity}</p>}
    {notes && <p style="margin: 0;"><strong>Your notes:</strong> {notes}</p>}
  </div>

  {gleanerNote &&
  <div style="background: #fef3c7; border-radius: 8px; padding: 16px; margin: 24px 0;">
    <h3 style="margin: 0 0 8px 0; color: #92400e;">Message from {gleanerName}</h3>
    <p style="margin: 0;">{gleanerNote}</p>
  </div>
  }

  <p>Simply <strong>reply to this email</strong> to get in touch with {gleanerName}.</p>

  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 32px 0;">

  <p style="color: #666; font-size: 14px;">
    All done with this listing?
    <a href="{unavailableUrl}" style="color: #4a7c23;">Mark as unavailable</a>
  </p>
</body>
</html>
```

---

## UI Flows

### Listing Detail Page (`/listings/:id`)

**Route**: `src/routes/listings.$id.tsx`

The `$id` parameter is accessed via `params.id` in the route loader.

**Display**:
- Produce type (h1)
- Status badge (active/unavailable/private)
- Variety (if provided)
- Quantity (if provided)
- Harvest window (if provided)
- Location: city, state only (privacy: no street address)
- Owner's notes (if provided)

**Conditional Content**:
- If status is `active` or `private`: show InquiryForm
- If status is `unavailable`: show "Check back later" message, no form
- If listing not found or deleted: show 404 message

---

### InquiryForm Component

**States**:
1. **Initial (authenticated)**: Note textarea + "Put me in touch" button
2. **Initial (unauthenticated)**: Email field + Note textarea + button
3. **Awaiting magic link**: MagicLinkWaiting component (reuse existing)
4. **Submitting**: Disabled button with "Sending..." text
5. **Success**: Confirmation message
6. **Rate limited**: "You've already contacted this owner recently" message

**Flow (authenticated user)**:
1. User enters optional note
2. Clicks "Put me in touch"
3. POST /api/inquiries
4. If rate limited (400): show rate limit message
5. If success: show confirmation (note if email failed)

**Flow (unauthenticated user)**:
1. User enters email and optional note
2. Clicks "Put me in touch"
3. Store `{ listingId, note }` in sessionStorage (key: `pendingInquiry`)
4. Trigger magic link flow with callback to `/listings/:id?inquiry_complete=true`
5. After verification, auto-submit stored inquiry
6. Show success message

**SessionStorage Limitation**: If user opens magic link in different browser/tab, pending inquiry is lost. This is acceptable for MVP (documented in ROADMAP future enhancements).

---

### My Listings Page Updates (`/garden/mine`)

**Status Badge Classes**:
```css
.status-badge.status-active {
  background: oklch(from var(--color-secondary) l c h / 0.15);
  color: var(--color-secondary);
}

.status-badge.status-unavailable {
  background: oklch(from var(--color-quiet) l c h / 0.15);
  color: var(--color-quiet);
}

.status-badge.status-private {
  background: oklch(from var(--color-accent) l c h / 0.15);
  color: var(--color-accent);
}
```

**Status Toggle Button**:
- If active: "Mark Unavailable" button
- If unavailable: "Mark Active" button
- Shows loading state during PATCH request
- On error: revert to previous state, show error message

**Note**: Private status toggle not in MVP UI - owners can only toggle active/unavailable.

---

### Home Page Updates (`/index.tsx`)

Make plant cards clickable:

```tsx
<Link to={`/listings/${plant.id}`} class="plant-card surface-subtle">
  {/* existing card content */}
</Link>
```

**Add hover/focus states** (`src/routes/index.css`):

```css
.plant-card {
  text-decoration: none;
  color: inherit;
  display: block;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.plant-card:hover,
.plant-card:focus {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px oklch(from var(--color-quiet) l c h / 0.15);
}

.plant-card:focus {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}
```

---

## Implementation Order

### Phase 1: Database Layer (atomic - deploy together)
1. Update `src/data/schema.ts` - add inquiries table, add deletedAt to plants
2. Create migration `drizzle/0003_add_inquiries.sql`
3. Update `src/data/queries.ts` - all query changes (status filter, soft delete, new functions)
4. Run migration, then deploy code

### Phase 2: Utilities
5. Create `src/lib/hmac.ts` - HMAC utilities
6. Update `src/lib/validation.ts` - add inquiry schemas
7. Create `src/lib/email-templates.ts` - inquiry email builder

### Phase 3: API Endpoints
8. Create `src/routes/api/inquiries.ts`
9. Create `src/routes/api/listings.$id.ts`
10. Create `src/routes/api/plants.$id.unavailable.ts`

### Phase 4: UI Components
11. Create `src/components/InquiryForm.tsx` + CSS
12. Create `src/routes/listings.$id.tsx` + CSS

### Phase 5: Updates to Existing Pages
13. Update `src/routes/garden/mine.tsx` - add status toggle with loading state
14. Update `src/routes/garden/mine.css` - new status classes, toggle button
15. Update `src/routes/index.tsx` - make cards clickable links
16. Update `src/routes/index.css` - hover/focus states

---

## Environment Variables

Add to `.env`:
```
HMAC_SECRET=generate-a-secure-random-string
```

For production (Fly.io):
```bash
fly secrets set HMAC_SECRET=$(openssl rand -hex 32)
```

---

## Out of Scope (Future Enhancements)

- In-app notifications (badge on "My Listings")
- Inquiry history view for owners
- Server-side pending inquiry storage (cross-browser magic link)
- Reminder email cadence (10 days, 30 days, season end)
- `reminderSentAt` field on plants table
- Gleaner profiles
- Inquiry outcome tracking ("How did it go?")
- Private status toggle in UI (schema supports it, UI deferred)
