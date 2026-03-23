# Listing Photos

## Scope

User-uploaded photos for Listings. This plan targets the MVP milestone (~1,000 listings).
At 3 photos per listing and ~500 KB each after browser compression that's ~1.5 GB — well
within any reasonable storage budget for months to come.

## Decisions

### Storage: Tigris (Fly.io native object storage)

Tigris is Fly.io's built-in S3-compatible blob store. It is:

- **Native to Fly.io** — no new vendor account, billed through Fly
- **S3-compatible** — use `@aws-sdk/client-s3` with standard patterns
- **Globally distributed** — avoids the single-machine dependency of a Fly Volume
- **Free tier** — 5 GB storage, 50 GB egress/month; adequate for years at MVP scale

Alternative considered: Fly Volume at `/app/data/uploads/`. Simpler to start, but a volume
is attached to one VM. If the machine is replaced or we ever scale to two instances, uploads
on the old volume become inaccessible. Tigris avoids that failure mode at negligible extra cost.

We are **not** moving SQLite to a hosted provider — there is no reason to couple that migration
to this feature.

### Serving: public Tigris bucket, direct from CDN

Listing photos are public data — there is nothing sensitive about a picture of an apple tree.
Signed URLs would add latency, expiry complexity, and caching friction without benefit.

Photos are served directly from Tigris at:

```
https://<bucket>.fly.storage.tigris.dev/<key>
```

The CSP `img-src` directive needs one new entry for this host (see PR 4).

We are **not** adding `sharp` or any server-side image pipeline for MVP. Instead, enforce
limits at the boundary: JPEG / PNG / WEBP only, ≤ 5 MB per file, ≤ 3 photos per listing.
Modern phone cameras produce images well under 5 MB in JPEG format. We can add resizing
later if storage costs or page-weight become a concern.

### Dev / test: `STORAGE_PROVIDER=local`

Following the `EMAIL_PROVIDER` discriminated-union pattern in `env.server.ts`:

| `STORAGE_PROVIDER` | Behavior |
|--------------------|----------|
| `local` (default in dev/test) | Write to `/app/data/uploads/`; serve from `GET /api/uploads/:key` |
| `tigris` (required in production) | Upload via `@aws-sdk/client-s3`; serve from Tigris CDN URL |

This keeps E2E tests fully offline — no Tigris credentials needed in CI or local dev.

### DB schema: `listing_photos` table

A separate table rather than a JSON column on `listings`:

- Supports ordering and per-photo metadata (alt text, caption) later
- Clean foreign key with cascade delete — deleting a listing removes its photo rows
- Storage key stored alongside URL so we can delete from Tigris on row removal

```typescript
// schema.ts addition
export const listingPhotos = sqliteTable(
  'listing_photos',
  {
    id:        integer('id').primaryKey({ autoIncrement: true }),
    listingId: integer('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    key:       text('key').notNull(),   // storage key, e.g. listings/42/uuid.jpg
    url:       text('url').notNull(),   // full public URL
    order:     integer('order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  },
  (t) => [index('listing_photos_listing_id_idx').on(t.listingId)]
)
```

### Open questions (decide before PR 3)

1. **Upload timing** — during listing creation (file selected before submit, uploaded as a
   separate request after the listing is created) or as a post-creation edit step? The
   "after create" flow is simpler: the listing ID is known, and there is no risk of orphaned
   uploads. Recommended: upload after redirect to the new listing's detail page.

2. **Cover photo** — do listing cards on the home/map page show the first photo? If yes, the
   public listing query needs to join `listing_photos` with `ORDER BY order LIMIT 1`. Flag
   this for PR 3 scope.

3. **Required vs. optional** — at MVP, photos should be optional. The listing form already
   works without them.

---

## Pull Requests

### PR 1 — Storage infrastructure

**Risk:** Low — no UI changes, nothing user-visible.
**Depends on:** nothing.

- Add `STORAGE_PROVIDER` to `env.server.ts` as a discriminated union; require `tigris` in
  production (mirror the `EMAIL_PROVIDER` superRefine check).
- Add `BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`
  to the `tigris` branch.
- Create `src/lib/storage.server.ts` exposing:
  ```typescript
  uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string> // returns public URL
  deleteFile(key: string): Promise<void>
  ```
- `local` provider: write to `<DATA_DIR>/uploads/`, return `/api/uploads/${key}`.
- `tigris` provider: `PutObjectCommand` with `ContentType` and `ACL: 'public-read'`, return
  `https://${BUCKET_NAME}.fly.storage.tigris.dev/${key}`.
- Add `GET /api/uploads/$key` route (local provider only — 404 in production; the env guard
  keeps the route dead in prod builds).
- Add `STORAGE_PROVIDER=local` to `.env.development` and `.env.test`.
- Unit tests: `uploadFile` + URL shape for local provider.

**Test for success:** `pnpm test` passes; `uploadFile` returns a path served by the dev
server; `deleteFile` removes the file.

---

### PR 2 — DB schema + queries

**Risk:** Low — additive migration, no breaking changes to existing queries.
**Depends on:** nothing (can merge in parallel with PR 1).

- Add `listingPhotos` table to `schema.ts`.
- Generate and commit migration (`pnpm db:migrate`).
- Add to `queries.ts`:
  - `addPhotoToListing(listingId, key, url, order)` → inserted row
  - `getPhotosForListing(listingId)` → `{ id, url, order }[]`
  - `deleteListingPhoto(photoId)` → `{ key }` (caller handles storage deletion)
- Update `public-listing.ts` to include `photos: { url }[]` in the public shape (join on
  `listing_photos ORDER BY order LIMIT 3`).
- Unit tests for new queries (follow `toPublicListing.test.ts` pattern).

**Test for success:** `pnpm test` passes; migration applies cleanly on a fresh DB.

---

### PR 3 — Upload / delete API

**Risk:** Medium — new API surface, auth enforcement, file parsing.
**Depends on:** PR 1 and PR 2 merged.

- `POST /api/listings/:id/photos` (listing owner only):
  - Parse `multipart/form-data` (use `request.formData()`; no new library needed in
    Node 22+ / WinterCG environments).
  - Validate with Zod: MIME type in `['image/jpeg', 'image/png', 'image/webp']`, size ≤ 5 MB,
    current photo count < 3.
  - Generate key: `listings/${id}/${crypto.randomUUID()}.${ext}`.
  - Upload via `storage.server.ts`.
  - Insert into `listing_photos`.
  - Return `201 { id, url }`.
- `DELETE /api/listings/:id/photos/:photoId` (listing owner only):
  - Fetch photo row, verify `listingId` matches, delete from storage then DB.
  - Return `204`.
- Unit tests for validation edge cases (wrong MIME type, oversized, fourth photo).

**Test for success:** `pnpm test` passes. Manual smoke test: upload a photo via curl,
confirm file appears in `/app/data/uploads/` in dev, confirm `GET /api/uploads/:key`
returns the image.

---

### PR 4 — UI + CSP update

**Risk:** Medium — form changes, CSP changes visible to all users.
**Depends on:** PR 3 merged.

- **Listing form** (`listings/new.tsx`): add an optional file input after the form submits
  successfully. On redirect to the new listing page the component auto-uploads any selected
  files via `POST /api/listings/:id/photos`, then refreshes the listing data.
- **Listing detail** (`listings.$id.tsx`): render a photo gallery if `listing.photos` is
  non-empty; show nothing (no placeholder) if empty.
- **CSP** (`security-headers.ts`): add `https://*.fly.storage.tigris.dev` to `img-src`.
  Update `security-headers.test.ts` to assert the new entry.
- **Permissions-Policy**: no camera permission needed — the browser file picker does not
  require it.

E2E test (`tests/e2e/listing-photos.test.ts`):

```typescript
test('owner can upload a photo that appears on the listing detail', async ({
  page, testUser, testListing,
}) => {
  await loginUser(page, testUser)
  await page.goto(`/listings/${testListing.id}`)
  await page.getByLabel(/Add photos/i).setInputFiles('tests/fixtures/test-photo.png')
  await page.waitForResponse((r) => r.url().includes('/api/listings/') && r.status() === 201)
  await expect(page.getByRole('img', { name: /listing photo/i })).toBeVisible()
})
```

Add `tests/fixtures/test-photo.png` — a 1×1 white PNG, checked into the repo.

**Test for success:** E2E test passes with `STORAGE_PROVIDER=local`; CSP test passes;
uploaded photo renders on the detail page.

---

## Dependency diagram

```
PR 1 (storage infra)  ──┐
                         ├──► PR 3 (API) ──► PR 4 (UI + CSP)
PR 2 (DB schema)     ──┘
```

PRs 1 and 2 can be reviewed and merged in parallel. PR 3 needs both. PR 4 needs PR 3.
