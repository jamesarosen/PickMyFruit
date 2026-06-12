import { db } from './db.server'
import {
	listings,
	inquiries,
	listingPhotos,
	user,
	addressReveals,
	usedLinkNonces,
	type Listing,
	type NewListing,
	type Inquiry,
	type NewInquiry,
	type AddressFields,
	type ListingPhoto,
	type AddressReveal,
} from './schema.server'
import { eq, desc, and, ne, isNull, gt, lt, inArray, sql } from 'drizzle-orm'
import {
	ListingStatus,
	type ListingStatusValue,
	type AddressReleasePolicyValue,
} from '@/lib/validation'
import { Sentry } from '@/lib/sentry'
import { storage } from '@/lib/storage.server'
import { SIGNATURE_MAX_AGE_MS } from '@/lib/signed-url'
import {
	toPublicListing,
	type PublicListing,
	type PublicPhoto,
	type OwnerListingView,
} from './listing'
import { ALLOWED_EXT } from '@/lib/listing-photo-upload.server'
export { type PublicListing, type OwnerListingView } from './listing'

export type { AddressFields } from './schema.server'

/** Thrown when a DB invariant is violated — e.g. an INSERT RETURNING produces no row. */
export class DataInvariantError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'DataInvariantError'
	}
}

function reportH3Error(listingId: number, error: unknown) {
	Sentry.captureException(error, { extra: { listingId } })
}

/**
 * Fetches non-deleted photos for a set of listing IDs in a single query and
 * groups them by listing ID, ordered by `order` ascending.
 * Throws when more than 100 IDs are requested so call sites fail fast instead
 * of silently dropping photos.
 */
const MAX_PHOTO_LOOKUP_LISTING_IDS = 100

async function fetchPhotosByListingIds(
	listingIds: number[]
): Promise<Map<number, PublicPhoto[]>> {
	if (listingIds.length === 0) return new Map()
	if (listingIds.length > MAX_PHOTO_LOOKUP_LISTING_IDS) {
		throw new DataInvariantError(
			`fetchPhotosByListingIds: expected at most ${MAX_PHOTO_LOOKUP_LISTING_IDS} listing IDs, received ${listingIds.length}`
		)
	}

	const uniqueIds = [...new Set(listingIds)]
	const rows = await db
		.select({
			id: listingPhotos.id,
			listingId: listingPhotos.listingId,
			ext: listingPhotos.ext,
			order: listingPhotos.order,
		})
		.from(listingPhotos)
		.where(inArray(listingPhotos.listingId, uniqueIds))
		.orderBy(listingPhotos.order)

	const map = new Map<number, PublicPhoto[]>()
	for (const row of rows) {
		const existing = map.get(row.listingId) ?? []
		existing.push({
			id: row.id,
			pubUrl: storage.publicUrl(`listing_photos/${row.id}.jpg`),
			order: row.order,
		})
		map.set(row.listingId, existing)
	}
	return map
}

/**
 * Fetches available listings with sensitive fields stripped.
 * @invariant Each listing's `photos` are sorted by `order` ascending — the
 * element at index 0 is the cover photo. Callers may rely on this without
 * re-sorting.
 */
export async function getAvailableListings(
	limit: number = 10
): Promise<PublicListing[]> {
	return Sentry.startSpan(
		{ name: 'getAvailableListings', op: 'db.query', attributes: { limit } },
		async (span) => {
			const rows = await db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.status, ListingStatus.available),
						isNull(listings.deletedAt)
					)
				)
				.orderBy(desc(listings.createdAt))
				.limit(limit)
			const photoMap = await fetchPhotosByListingIds(rows.map((r) => r.id))
			const results = rows.flatMap((row) => {
				const pub = toPublicListing(row, photoMap.get(row.id) ?? [], reportH3Error)
				return pub ? [pub] : []
			})
			span.setAttribute('listing_count', results.length)
			return results
		}
	)
}

/**
 * Fetches available listings ordered by proximity to a point.
 * @invariant Each listing's `photos` are sorted by `order` ascending — the
 * element at index 0 is the cover photo. Callers may rely on this without
 * re-sorting.
 */
export async function getNearbyListings(
	lat: number,
	lng: number,
	limit: number = 12
): Promise<PublicListing[]> {
	return Sentry.startSpan(
		{ name: 'getNearbyListings', op: 'db.query', attributes: { limit } },
		async (span) => {
			// Equirectangular approximation: a degree of longitude shrinks by
			// cos(latitude), so scale the longitude delta or east-west neighbors
			// rank ~22% too far at Napa's latitude. Fine at city scale; revisit
			// with Haversine or H3 prefiltering if coverage ever spans regions.
			const lngScale = Math.cos((lat * Math.PI) / 180)
			const rows = await db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.status, ListingStatus.available),
						isNull(listings.deletedAt)
					)
				)
				.orderBy(
					sql`(${listings.lat} - ${lat}) * (${listings.lat} - ${lat}) + ((${listings.lng} - ${lng}) * ${lngScale}) * ((${listings.lng} - ${lng}) * ${lngScale})`
				)
				.limit(limit)
			const photoMap = await fetchPhotosByListingIds(rows.map((r) => r.id))
			const results = rows.flatMap((row) => {
				const pub = toPublicListing(row, photoMap.get(row.id) ?? [], reportH3Error)
				return pub ? [pub] : []
			})
			span.setAttribute('listing_count', results.length)
			return results
		}
	)
}

export async function createListing(data: NewListing): Promise<Listing> {
	return Sentry.startSpan(
		{ name: 'createListing', op: 'db.query' },
		async () => {
			const result = await db.insert(listings).values(data).returning()
			return result[0]
		}
	)
}

/**
 * Fetches all non-deleted listings owned by the given user.
 * @invariant Each listing's `photos` are sorted by `order` ascending — the
 * element at index 0 is the cover photo. Callers may rely on this without
 * re-sorting.
 */
export async function getUserListings(
	userId: string
): Promise<OwnerListingView[]> {
	return Sentry.startSpan(
		{ name: 'getUserListings', op: 'db.query' },
		async (span) => {
			const results = await db
				.select()
				.from(listings)
				.where(and(eq(listings.userId, userId), isNull(listings.deletedAt)))
				.orderBy(desc(listings.createdAt))
			span.setAttribute('listing_count', results.length)
			const photoMap = await fetchPhotosByListingIds(results.map((l) => l.id))
			return results.map((listing) => {
				const photos = photoMap.get(listing.id) ?? []
				return { ...listing, photos }
			})
		}
	)
}

export async function getListingById(id: number): Promise<Listing | undefined> {
	return Sentry.startSpan(
		{ name: 'getListingById', op: 'db.query', attributes: { id } },
		async () => {
			const result = await db
				.select()
				.from(listings)
				.where(and(eq(listings.id, id), isNull(listings.deletedAt)))
				.limit(1)
			return result[0]
		}
	)
}

/**
 * Fetches a listing by ID, returning only public-safe fields. Excludes private
 * and deleted listings.
 * @invariant The returned listing's `photos` are sorted by `order` ascending —
 * the element at index 0 is the cover photo. Callers may rely on this without
 * re-sorting.
 */
export async function getPublicListingById(
	id: number
): Promise<PublicListing | undefined> {
	return Sentry.startSpan(
		{ name: 'getPublicListingById', op: 'db.query', attributes: { id } },
		async () => {
			const [result, photoMap] = await Promise.all([
				db
					.select()
					.from(listings)
					.where(
						and(
							eq(listings.id, id),
							ne(listings.status, ListingStatus.private),
							isNull(listings.deletedAt)
						)
					)
					.limit(1),
				fetchPhotosByListingIds([id]),
			])
			if (!result[0]) return undefined
			return (
				toPublicListing(result[0], photoMap.get(id) ?? [], reportH3Error) ??
				undefined
			)
		}
	)
}

/** Soft-deletes a listing by setting its deletedAt timestamp and removes related inquiries. */
export async function deleteListingById(
	id: number,
	userId: string
): Promise<boolean> {
	return Sentry.startSpan(
		{ name: 'deleteListingById', op: 'db.query', attributes: { id } },
		async () => {
			// Transactional so a crash can't leave the listing soft-deleted while
			// its inquiries survive (the FK cascade only fires on hard deletes).
			return db.transaction(async (tx) => {
				const result = await tx
					.update(listings)
					.set({ deletedAt: new Date() })
					.where(
						and(
							eq(listings.id, id),
							eq(listings.userId, userId),
							isNull(listings.deletedAt)
						)
					)
					.returning({ id: listings.id })

				if (result.length > 0) {
					await tx.delete(inquiries).where(eq(inquiries.listingId, id))
				}

				return result.length > 0
			})
		}
	)
}

// ============================================================================
// Photo Functions
// ============================================================================

/**
 * Inserts a photo record for a listing inside a transaction that atomically
 * checks the photo count and assigns `order` via MAX()+1.
 *
 * Returns `null` when the listing already has `maxPhotos` photos — the caller
 * is responsible for translating that into a user-facing error.
 */
export async function addPhotoToListing(
	listingId: number,
	id: string,
	ext: ALLOWED_EXT,
	maxPhotos: number
): Promise<ListingPhoto | null> {
	return Sentry.startSpan(
		{
			name: 'addPhotoToListing',
			op: 'db.query',
			attributes: { listingId },
		},
		async () => {
			return db.transaction(async (tx) => {
				const [{ count }] = await tx
					.select({ count: sql<number>`COUNT(*)` })
					.from(listingPhotos)
					.where(eq(listingPhotos.listingId, listingId))
				if (Number(count) >= maxPhotos) return null

				const result = await tx
					.insert(listingPhotos)
					.values({
						id,
						listingId,
						ext,
						// Compute order atomically so concurrent inserts don't collide.
						order: sql`COALESCE(
							(SELECT MAX("order") FROM listing_photos
							 WHERE listing_id = ${listingId}),
							-1
						) + 1`,
					})
					.returning()
				if (!result[0])
					throw new DataInvariantError('addPhotoToListing: insert returned no row')
				return result[0]
			})
		}
	)
}

/**
 * Returns public photo data for a listing. rawKey is never exposed.
 * @invariant The returned photos are sorted by `order` ascending — the
 * element at index 0 is the cover photo. Callers may rely on this without
 * re-sorting.
 */
export async function getPhotosForListing(
	listingId: number
): Promise<PublicPhoto[]> {
	return Sentry.startSpan(
		{
			name: 'getPhotosForListing',
			op: 'db.query',
			attributes: { listingId },
		},
		async () => {
			const rows = await db
				.select({
					id: listingPhotos.id,
					ext: listingPhotos.ext,
					order: listingPhotos.order,
				})
				.from(listingPhotos)
				.where(eq(listingPhotos.listingId, listingId))
				.orderBy(listingPhotos.order)
			return rows.map((row) => ({
				id: row.id,
				pubUrl: storage.publicUrl(`listing_photos/${row.id}.jpg`),
				order: row.order,
			}))
		}
	)
}

/**
 * Hard-deletes a photo record and returns its rawKey so the caller can remove
 * both storage objects (raw/ and pub/ share the same key).
 *
 * We use a hard delete (not soft) because the storage objects must be cleaned
 * up immediately. A soft delete would leave orphaned objects indefinitely.
 *
 * Ownership is enforced in the WHERE clause: the photo is only deleted if
 * its listing is owned by the given user. Returns undefined if the photo
 * does not exist or the user does not own the listing.
 */
export async function deleteListingPhoto(
	photoId: string,
	userId: string
): Promise<{ id: string; ext: string } | undefined> {
	return Sentry.startSpan(
		{
			name: 'deleteListingPhoto',
			op: 'db.query',
			attributes: { photoId },
		},
		async () => {
			const result = await db
				.delete(listingPhotos)
				.where(
					and(
						eq(listingPhotos.id, photoId),
						// Ownership check: the photo's listing must belong to userId
						sql`listing_id IN (SELECT id FROM listings WHERE user_id = ${userId} AND deleted_at IS NULL)`
					)
				)
				.returning({ id: listingPhotos.id, ext: listingPhotos.ext })
			return result[0]
		}
	)
}

// ============================================================================
// Inquiry Functions
// ============================================================================

export async function createInquiry(data: NewInquiry): Promise<Inquiry> {
	return Sentry.startSpan(
		{ name: 'createInquiry', op: 'db.query' },
		async () => {
			const result = await db.insert(inquiries).values(data).returning()
			return result[0]
		}
	)
}

/**
 * Same insert as {@link createInquiry} but runs on a caller-supplied libSQL
 * transaction. Used by kokoto's `ctx.txStep`, which commits the row and the
 * `_dc_step` log entry in one transaction — eliminating the at-least-once
 * duplicate-row hazard on workflow retry.
 */
export async function createInquiryTx(
	tx: import('@pickmyfruit/kokoto/runtime.server').SqlTransaction,
	data: {
		listingId: number
		gleanerId: string
		note: string | null
		emailSentAt: Date
	}
): Promise<{ id: number }> {
	const result = await tx.execute({
		sql: `INSERT INTO inquiries (listing_id, gleaner_id, note, email_sent_at)
			VALUES (?, ?, ?, ?)
			RETURNING id`,
		args: [
			data.listingId,
			data.gleanerId,
			data.note ?? null,
			Math.floor(data.emailSentAt.getTime() / 1000),
		],
	})
	const id = result.rows[0]?.id
	if (typeof id !== 'number') {
		throw new Error('createInquiryTx: INSERT … RETURNING id produced no row')
	}
	return { id }
}

export async function hasRecentInquiry(
	gleanerId: string,
	listingId: number
): Promise<boolean> {
	return Sentry.startSpan(
		{ name: 'hasRecentInquiry', op: 'db.query', attributes: { listingId } },
		async () => {
			const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
			const result = await db
				.select({ id: inquiries.id })
				.from(inquiries)
				.where(
					and(
						eq(inquiries.gleanerId, gleanerId),
						eq(inquiries.listingId, listingId),
						gt(inquiries.createdAt, twentyFourHoursAgo)
					)
				)
				.limit(1)
			return result.length > 0
		}
	)
}

/** An inquiry on one of the owner's listings, with gleaner contact info. */
export type OwnerInquiry = {
	id: number
	createdAt: Date
	note: string | null
	listingId: number
	listingName: string
	gleanerName: string
	gleanerEmail: string
}

/** Fetches recent inquiries across all of an owner's listings, newest first. */
export async function getInquiriesForOwner(
	ownerId: string,
	limit = 50
): Promise<OwnerInquiry[]> {
	return Sentry.startSpan(
		{ name: 'getInquiriesForOwner', op: 'db.query' },
		async () => {
			return db
				.select({
					id: inquiries.id,
					createdAt: inquiries.createdAt,
					note: inquiries.note,
					listingId: inquiries.listingId,
					listingName: listings.name,
					gleanerName: user.name,
					gleanerEmail: user.email,
				})
				.from(inquiries)
				.innerJoin(listings, eq(inquiries.listingId, listings.id))
				.innerJoin(user, eq(inquiries.gleanerId, user.id))
				.where(and(eq(listings.userId, ownerId), isNull(listings.deletedAt)))
				.orderBy(desc(inquiries.createdAt))
				.limit(limit)
		}
	)
}

export async function getListingWithOwner(id: number): Promise<
	| {
			listing: Listing
			owner: { id: string; name: string; email: string }
	  }
	| undefined
> {
	return Sentry.startSpan(
		{ name: 'getListingWithOwner', op: 'db.query', attributes: { id } },
		async () => {
			const result = await db
				.select({
					listing: listings,
					owner: {
						id: user.id,
						name: user.name,
						email: user.email,
					},
				})
				.from(listings)
				.innerJoin(user, eq(listings.userId, user.id))
				.where(and(eq(listings.id, id), isNull(listings.deletedAt)))
				.limit(1)

			return result[0]
		}
	)
}

export async function getListingForInquiry(
	id: number
): Promise<Listing | undefined> {
	return Sentry.startSpan(
		{ name: 'getListingForInquiry', op: 'db.query', attributes: { id } },
		async () => {
			const result = await db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.id, id),
						isNull(listings.deletedAt)
						// Status validation (available or private) done at API layer
					)
				)
				.limit(1)
			return result[0]
		}
	)
}

export type UpdateListingResult =
	| { tag: 'updated'; listing: Listing }
	| { tag: 'conflict' }
	| { tag: 'not_found' }

/**
 * Updates any combination of listing fields for the owning user.
 *
 * `clientUpdatedAt` (epoch seconds) implements If-Unmodified-Since semantics:
 * the update is applied only when the row's `updated_at` matches. If it
 * doesn't match, returns `{ tag: 'conflict' }` so callers can surface a
 * human-readable error rather than silently discarding the edit.
 */
export async function updateListingById(
	id: number,
	userId: string,
	clientUpdatedAt: number,
	fields: {
		status?: ListingStatusValue
		name?: string
		harvestWindow?: string | null
		variety?: string | null
		quantity?: string | null
		notes?: string | null
		addressReleasePolicy?: AddressReleasePolicyValue
	}
): Promise<UpdateListingResult> {
	return Sentry.startSpan(
		{ name: 'updateListingById', op: 'db.query', attributes: { id } },
		async () => {
			const result = await db
				.update(listings)
				.set({ ...fields, updatedAt: new Date() })
				.where(
					and(
						eq(listings.id, id),
						eq(listings.userId, userId),
						isNull(listings.deletedAt),
						eq(listings.updatedAt, new Date(clientUpdatedAt * 1000))
					)
				)
				.returning()

			if (result[0]) return { tag: 'updated', listing: result[0] }

			// Distinguish stale-write (conflict) from missing / wrong owner (not found)
			const exists = await db
				.select({ id: listings.id })
				.from(listings)
				.where(
					and(
						eq(listings.id, id),
						eq(listings.userId, userId),
						isNull(listings.deletedAt)
					)
				)
				.limit(1)

			return exists.length > 0 ? { tag: 'conflict' } : { tag: 'not_found' }
		}
	)
}

export async function getUserById(
	id: string
): Promise<{ name: string; email: string } | undefined> {
	return Sentry.startSpan({ name: 'getUserById', op: 'db.query' }, async () => {
		const result = await db
			.select({ name: user.name, email: user.email })
			.from(user)
			.where(eq(user.id, id))
			.limit(1)
		return result[0]
	})
}

/** Returns address fields from the user's most recent non-deleted listing. */
export async function getUserLastAddress(
	userId: string
): Promise<AddressFields | undefined> {
	return Sentry.startSpan(
		{ name: 'getUserLastAddress', op: 'db.query' },
		async () => {
			const result = await db
				.select({
					address: listings.address,
					city: listings.city,
					state: listings.state,
					zip: listings.zip,
				})
				.from(listings)
				.where(and(eq(listings.userId, userId), isNull(listings.deletedAt)))
				.orderBy(desc(listings.createdAt))
				.limit(1)
			return result[0]
		}
	)
}

// ============================================================================
// Address Reveal Functions
// ============================================================================

/**
 * Appends an `address_reveals` row. Append-only by design — repeat reveals
 * are a real engagement signal, so we record every one (no dedupe).
 */
export async function recordAddressReveal(
	userId: string,
	listingId: number
): Promise<AddressReveal> {
	return Sentry.startSpan(
		{
			name: 'recordAddressReveal',
			op: 'db.query',
			attributes: { listingId },
		},
		async () => {
			const result = await db
				.insert(addressReveals)
				.values({ userId, listingId })
				.returning()
			if (!result[0])
				throw new DataInvariantError('recordAddressReveal: insert returned no row')
			return result[0]
		}
	)
}

export type MarkUnavailableResult = 'marked' | 'already_used' | 'not_found'

/** Thrown inside the transaction to roll back the status update on a replayed nonce. */
class NonceAlreadyUsedError extends Error {}

/**
 * Marks a listing as unavailable via an HMAC-signed one-click URL, consuming
 * the URL's nonce so the link cannot be replayed — e.g. to re-mark a listing
 * the grower has since re-listed.
 */
export async function markListingUnavailable(
	id: number,
	nonce: string
): Promise<MarkUnavailableResult> {
	return Sentry.startSpan(
		{ name: 'markListingUnavailable', op: 'db.query', attributes: { id } },
		async () => {
			try {
				return await db.transaction(async (tx) => {
					const updated = await tx
						.update(listings)
						.set({ status: ListingStatus.unavailable, updatedAt: new Date() })
						.where(and(eq(listings.id, id), isNull(listings.deletedAt)))
						.returning({ id: listings.id })
					if (updated.length === 0) return 'not_found'
					const consumed = await tx
						.insert(usedLinkNonces)
						.values({ nonce, listingId: id })
						.onConflictDoNothing()
						.returning({ nonce: usedLinkNonces.nonce })
					if (consumed.length === 0) throw new NonceAlreadyUsedError()
					// Nonces older than the signature window are dead weight — their
					// links are already rejected as expired before reaching the DB.
					await tx
						.delete(usedLinkNonces)
						.where(
							lt(usedLinkNonces.usedAt, new Date(Date.now() - SIGNATURE_MAX_AGE_MS))
						)
					return 'marked'
				})
			} catch (error) {
				if (error instanceof NonceAlreadyUsedError) return 'already_used'
				throw error
			}
		}
	)
}
