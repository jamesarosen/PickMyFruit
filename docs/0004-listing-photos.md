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

### EXIF handling: two copies per photo

Phone photos embed GPS coordinates, device identifiers, and other metadata in EXIF. We want
to preserve the raw EXIF for potential future features (e.g. pre-filling a location during
signup from a photo) while serving a clean copy to the public.

On upload we store two objects:

| Key prefix                   | ACL         | Contents                                            |
| ---------------------------- | ----------- | --------------------------------------------------- |
| `raw/listings/:id/:uuid.ext` | private     | Original file; full EXIF intact                     |
| `pub/listings/:id/:uuid.ext` | public-read | EXIF-stripped copy; served directly from Tigris CDN |

**Will the raw copy be publicly readable?**
No. S3 objects default to private. A direct GET request to the raw key URL returns 403.
Only server-side code that holds AWS credentials can call `GetObject` on a private key.

**Can a user enumerate raw URLs?**
With the defaults, `ListObjectsV2` on a bucket requires authentication — unauthenticated
callers cannot list object keys. To be explicit, set a bucket policy that denies
`s3:ListBucket` to `*` (the public). Even if listing were somehow enabled, UUID-based keys
(2¹²² entropy) make guessing infeasible. Between private ACL, disabled listing, and UUID
keys, the raw copy is inaccessible to anyone without AWS credentials.

The DB stores both `rawKey` (server-side only) and `pubUrl` (returned to clients).

EXIF stripping is done server-side with `sharp` — a single
`.withMetadata(false).toBuffer()` pass, no resizing needed.

### Serving: public Tigris CDN for cleaned copies

`pub/listings/:id/:uuid.ext` is `ACL: public-read` and served from:

```
https://<bucket>.fly.storage.tigris.dev/pub/listings/:id/:uuid.ext
```

This URL is stored in `listing_photos.pubUrl` and returned in listing API responses.
The CSP `img-src` directive needs one new entry for this host (see PR 4).

### Storage adapter pattern

The storage provider is injected as an adapter rather than checked inline at call sites.
This mirrors the direction we plan to take `EMAIL_PROVIDER` — env config selects the
implementation at startup; callers receive a typed interface.

```typescript
// src/lib/storage.server.ts

export interface StorageAdapter {
  /** Store a file. 'private' objects are never publicly accessible. */
  upload(key: string, buffer: Buffer, opts: { mimeType: string, access: 'private' | 'public' }): Promise<void>
  /** Read a file server-side (for private objects). */
  read(key: string): Promise<Buffer>
  /** Return the public URL for a 'public' key. Throws if access was 'private'. */
  publicUrl(key: string): string
  /** Delete a file. */
  delete(key: string): Promise<void>
}

export function createStorageAdapter(env: ServerEnv): StorageAdapter { ... }

/** Singleton — import this in route handlers and server fns. */
export const storage: StorageAdapter = createStorageAdapter(serverEnv)
```

`STORAGE_PROVIDER` is still a discriminated union in `env.server.ts` (same Zod pattern as
`EMAIL_PROVIDER`), but the union is consumed once in `createStorageAdapter` and never
checked again in application code.

Local adapter (`STORAGE_PROVIDER=local`):

- `upload(..., 'public')` — writes to `<DATA_DIR>/uploads/pub/...`; `publicUrl` returns `/api/uploads/pub/:key`
- `upload(..., 'private')` — writes to `<DATA_DIR>/uploads/raw/...`; never exposed over HTTP
- `read` — reads from `<DATA_DIR>/uploads/raw/...`

Tigris adapter (`STORAGE_PROVIDER=tigris`, required in production):

- `upload(..., 'public')` — `PutObjectCommand` with `ACL: 'public-read'`
- `upload(..., 'private')` — `PutObjectCommand` with no ACL (default private)
- `publicUrl` — returns `https://${BUCKET_NAME}.fly.storage.tigris.dev/${key}`
- `read` — `GetObjectCommand` (credentials required; server-side only)

### DB schema: `listing_photos` table

A separate table rather than a JSON column on `listings`:

- Supports ordering and per-photo metadata (alt text, caption) later
- Clean foreign key with cascade delete — deleting a listing removes its photo rows
- Both `rawKey` and `pubUrl` stored so the server can read raw EXIF and clients see the
  clean URL

```typescript
// schema.ts addition
export const listingPhotos = sqliteTable(
	"listing_photos",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		listingId: integer("listing_id")
			.notNull()
			.references(() => listings.id, { onDelete: "cascade" }),
		rawKey: text("raw_key").notNull(), // private storage key; never sent to clients
		pubUrl: text("pub_url").notNull(), // public CDN URL of EXIF-stripped copy
		order: integer("order").notNull().default(0),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [index("listing_photos_listing_id_idx").on(t.listingId), index("listing_photos_listing_order_idx").on(t.listingId, t.order)],
);
```

The `(listingId, order)` composite index makes the cover-photo join fast:
`SELECT pub_url FROM listing_photos WHERE listing_id = ? ORDER BY order LIMIT 1`.

### Resolved design questions

1. **Upload timing** — after redirect to the listing detail page. Listing ID is known,
   UX is simple, no risk of orphaned uploads.
2. **Cover photo** — yes. `getAvailableListings` joins `listing_photos` for the first
   photo (`ORDER BY order LIMIT 1`) and includes `coverPhotoUrl` in the public listing
   shape. Covered by the composite index above.
3. **Required vs. optional** — photos are optional.
4. **Initial UI limit** — the UI exposes a single-file input for MVP. The API and DB
   are already N-photo capable; a one-photo UI is simply a client that calls
   `POST /api/listings/:id/photos` once. No bespoke single-photo endpoint or component
   needed. Raising the limit later (e.g. for garden stands) only requires a UI change.

---

## Pull Requests

### PR 1 — Storage adapter

**Risk:** Low — no UI changes, nothing user-visible.
**Depends on:** nothing.

- Add `STORAGE_PROVIDER` to `env.server.ts` as a discriminated union; require `tigris` in
  production (mirror the `EMAIL_PROVIDER` `superRefine` check).
- Add `BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL_S3`
  to the `tigris` branch.
- Create `src/lib/storage.server.ts` with `StorageAdapter` interface,
  `createStorageAdapter`, and the exported `storage` singleton.
- Add `GET /api/uploads/$key` route for the local adapter's public files (404 in
  production; env guard keeps the route dead in prod builds).
- Add `STORAGE_PROVIDER=local` to `.env.development` and `.env.test`.
- Add `sharp` to `apps/www` dependencies; verify multi-arch native binaries land
  correctly in the Docker build (follow the `@libsql` pattern in the Dockerfile).
- Unit tests: `upload` + `publicUrl` + `read` + `delete` roundtrip for local adapter.

**Test for success:** `pnpm test` passes; `upload(..., 'public')` returns a URL served
by the dev server; `read` retrieves private file contents; `delete` removes both.

---

### PR 2 — DB schema + queries

**Risk:** Low — additive migration, no breaking changes to existing queries.
**Depends on:** nothing (can merge in parallel with PR 1).

- Add `listingPhotos` table to `schema.ts` (schema above, both indexes).
- Generate and commit migration (`pnpm db:migrate`).
- Add to `queries.ts`:
  - `addPhotoToListing(listingId, rawKey, pubUrl, order)` → inserted row
  - `getPhotosForListing(listingId)` → `{ id, pubUrl, order }[]` (rawKey not exposed)
  - `deleteListingPhoto(photoId)` → `{ rawKey, pubUrl }` (caller handles storage deletion)
- Update `public-listing.ts` to include `coverPhotoUrl: string | null` (first photo by
  order) and `photos: { id, pubUrl }[]` in the public listing shape.
- Unit tests for new queries (follow `toPublicListing.test.ts` pattern).

**Test for success:** `pnpm test` passes; migration applies cleanly on a fresh DB.

---

### PR 3 — Upload / delete server function

**Risk:** Medium — new API surface, auth enforcement, file parsing, sharp integration.
**Depends on:** PR 1 and PR 2 merged.

- `addPhotoToListing: createServerFn({ method: 'POST' })` (listing owner only):
  - Parse `multipart/form-data` (use `request.formData()`; no new library needed).
  - Validate with Zod: MIME type in `['image/jpeg', 'image/png', 'image/webp']`,
    size ≤ 5 MB, current photo count < 3.
  - Generate base key: `listings/${id}/${crypto.randomUUID()}`.
  - `storage.upload('raw/' + baseKey + ext, rawBuffer, mimeType, 'private')`.
  - async import sharp, a node-only dependency
  - `const cleanBuffer = await sharp(rawBuffer).withMetadata(false).toBuffer()`.
  - `storage.upload('pub/' + baseKey + ext, cleanBuffer, mimeType, 'public')`.
  - Insert into `listing_photos`; return `201 { id, pubUrl }`.
- `deletePhoto: createServerFn({ method: 'DELETE' })` (listing owner only):
  - Fetch photo row; verify `listingId` matches; delete both raw and pub keys from
    storage, then delete DB row.
  - Return `204`.
- Unit tests: wrong MIME type, oversized file, fourth photo rejected, auth guard.

**Test for success:** `pnpm test` passes. Smoke test via curl: upload a JPEG, confirm
raw file appears in `<DATA_DIR>/uploads/raw/`, confirm EXIF is absent from the
pub file, confirm `GET /api/uploads/pub/...` serves the clean image.

---

### PR 4 — UI + CSP update

**Risk:** Medium — form changes, CSP change visible to all users.
**Depends on:** PR 3 merged.

- **Listing detail** (`listings.$id.tsx`): for the listing owner, show a single-file
  input + upload button below the listing details. On successful upload, refresh listing
  data to display the new photo. For all visitors, render the first photo (`listing.photos[0]`)
  if present; show nothing if empty. No gallery component needed for MVP — the N-photo
  infrastructure is in place whenever the limit is raised.
- **Home / map page**: listing cards show `coverPhotoUrl` as a thumbnail if present.
- **CSP** (`security-headers.ts`): add `https://*.fly.storage.tigris.dev` to `img-src`.
  Update `security-headers.test.ts` to assert the new entry.

E2E test (`tests/e2e/listing-photos.test.ts`):

```typescript
test("owner can upload a photo that appears on the listing detail", async ({ page, testUser, testListing }) => {
	await loginUser(page, testUser);
	await page.goto(`/listings/${testListing.id}`);
	await page.getByLabel(/Add photos/i).setInputFiles("tests/fixtures/test-photo.png");
	await page.getByRole("button", { name: /Upload/i }).click();
	await page.waitForResponse((r) => r.url().includes("/api/listings/") && r.status() === 201);
	await expect(page.getByRole("img", { name: /listing photo/i })).toBeVisible();
});
```

Add `tests/fixtures/test-photo.png` — a 1×1 white PNG checked into the repo.

**Test for success:** E2E test passes with `STORAGE_PROVIDER=local`; CSP test passes;
uploaded photo renders on the detail page; cover photo appears on a listing card.

---

## Dependency diagram

```
PR 1 (storage adapter)  ──┐
                            ├──► PR 3 (API) ──► PR 4 (UI + CSP)
PR 2 (DB schema)        ──┘
```

PRs 1 and 2 can be reviewed and merged in parallel. PR 3 needs both. PR 4 needs PR 3.
