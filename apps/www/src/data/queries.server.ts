import { db } from './db.server'
import {
	listings,
	inquiries,
	listingPhotos,
	user,
	type Listing,
	type NewListing,
	type Inquiry,
	type NewInquiry,
	type AddressFields,
	type ListingPhoto,
} from './schema'
import { eq, desc, and, ne, isNull, gt, inArray, sql } from 'drizzle-orm'
import { ListingStatus, type ListingStatusValue } from '@/lib/validation'
import { Sentry } from '@/lib/sentry'
import { storage } from '@/lib/storage.server'
import {
	toPublicListing,
	type PublicListing,
	type PublicPhoto,
} from './public-listing'
export { type PublicListing } from './public-listing'

export type { AddressFields } from './schema'

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
 * Capped at 100 IDs to stay within SQLite's variable limit.
 */
async function fetchPhotosByListingIds(
	listingIds: number[]
): Promise<Map<number, PublicPhoto[]>> {
	if (listingIds.length === 0) return new Map()
	const ids = listingIds.slice(0, 100)
	const rows = await db
		.select({
			id: listingPhotos.id,
			listingId: listingPhotos.listingId,
			ext: listingPhotos.ext,
			order: listingPhotos.order,
		})
		.from(listingPhotos)
		.where(
			and(inArray(listingPhotos.listingId, ids), isNull(listingPhotos.deletedAt))
		)
		.orderBy(listingPhotos.order)

	const map = new Map<number, PublicPhoto[]>()
	for (const row of rows) {
		const existing = map.get(row.listingId) ?? []
		existing.push({
			id: row.id,
			pubUrl: storage.publicUrl(`listing_photos/${row.id}${row.ext}`),
			order: row.order,
		})
		map.set(row.listingId, existing)
	}
	return map
}

/** Fetches available listings with sensitive fields stripped. */
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

/** Fetches available listings ordered by proximity to a point. */
export async function getNearbyListings(
	lat: number,
	lng: number,
	limit: number = 12
): Promise<PublicListing[]> {
	return Sentry.startSpan(
		{ name: 'getNearbyListings', op: 'db.query', attributes: { limit } },
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
				.orderBy(
					sql`(${listings.lat} - ${lat}) * (${listings.lat} - ${lat}) + (${listings.lng} - ${lng}) * (${listings.lng} - ${lng})`
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

export async function getUserListings(userId: string): Promise<Listing[]> {
	return Sentry.startSpan(
		{ name: 'getUserListings', op: 'db.query' },
		async (span) => {
			const results = await db
				.select()
				.from(listings)
				.where(and(eq(listings.userId, userId), isNull(listings.deletedAt)))
				.orderBy(desc(listings.createdAt))
			span.setAttribute('listing_count', results.length)
			return results
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

/** Fetches a listing by ID, returning only public-safe fields. Excludes private and deleted listings. */
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
			const result = await db
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
				await db.delete(inquiries).where(eq(inquiries.listingId, id))
			}

			return result.length > 0
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
	ext: string,
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
					.where(
						and(
							eq(listingPhotos.listingId, listingId),
							isNull(listingPhotos.deletedAt)
						)
					)
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
							 WHERE listing_id = ${listingId} AND deleted_at IS NULL),
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

/** Returns public photo data for a listing, ordered by `order`. rawKey is never exposed. */
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
				.where(
					and(
						eq(listingPhotos.listingId, listingId),
						isNull(listingPhotos.deletedAt)
					)
				)
				.orderBy(listingPhotos.order)
			return rows.map((row) => ({
				id: row.id,
				pubUrl: storage.publicUrl(`listing_photos/${row.id}${row.ext}`),
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

/** Updates a listing's status, scoped to the owning user. */
export async function updateListingStatus(
	id: number,
	userId: string,
	status: ListingStatusValue
): Promise<boolean> {
	return Sentry.startSpan(
		{ name: 'updateListingStatus', op: 'db.query', attributes: { id, status } },
		async () => {
			const result = await db
				.update(listings)
				.set({ status, updatedAt: new Date() })
				.where(
					and(
						eq(listings.id, id),
						eq(listings.userId, userId),
						isNull(listings.deletedAt)
					)
				)
				.returning({ id: listings.id })
			return result.length > 0
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

/** Mark a listing as unavailable (used by HMAC-signed one-click URL). */
export async function markListingUnavailable(id: number): Promise<boolean> {
	return Sentry.startSpan(
		{ name: 'markListingUnavailable', op: 'db.query', attributes: { id } },
		async () => {
			const result = await db
				.update(listings)
				.set({ status: ListingStatus.unavailable, updatedAt: new Date() })
				.where(and(eq(listings.id, id), isNull(listings.deletedAt)))
				.returning({ id: listings.id })
			return result.length > 0
		}
	)
}
