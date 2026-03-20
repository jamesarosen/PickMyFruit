import { db } from './db'
import {
	listings,
	inquiries,
	notificationSubscriptions,
	user,
	type Listing,
	type NewListing,
	type Inquiry,
	type NewInquiry,
	type AddressFields,
	type NotificationSubscription,
	type NewNotificationSubscription,
	type ThrottlePeriodValue,
} from './schema'
import { eq, desc, and, ne, isNull, gt, sql } from 'drizzle-orm'
import { ListingStatus, type ListingStatusValue } from '@/lib/validation'
import { Sentry } from '@/lib/sentry'
import { toPublicListing, type PublicListing } from './public-listing'
export { type PublicListing } from './public-listing'

export type { AddressFields } from './schema'

function reportH3Error(listingId: number, error: unknown) {
	Sentry.captureException(error, { extra: { listingId } })
}

/** Fetches available listings with sensitive fields stripped. */
export async function getAvailableListings(
	limit?: number
): Promise<PublicListing[]> {
	return Sentry.startSpan(
		{ name: 'getAvailableListings', op: 'db.query', attributes: { limit } },
		async (span) => {
			const baseQuery = db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.status, ListingStatus.available),
						isNull(listings.deletedAt)
					)
				)
				.orderBy(desc(listings.createdAt))
			const rows = await (limit !== undefined ? baseQuery.limit(limit) : baseQuery)
			const results = rows.flatMap((row) => {
				const pub = toPublicListing(row, reportH3Error)
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
			const results = rows.flatMap((row) => {
				const pub = toPublicListing(row, reportH3Error)
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
			const result = await db
				.select()
				.from(listings)
				.where(
					and(
						eq(listings.id, id),
						ne(listings.status, ListingStatus.private),
						isNull(listings.deletedAt)
					)
				)
				.limit(1)
			return result[0]
				? (toPublicListing(result[0], reportH3Error) ?? undefined)
				: undefined
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

// ============================================================================
// Notification Subscription Functions
// ============================================================================

/** Returns all notification subscriptions for a given user, newest first. */
export async function getUserSubscriptions(
	userId: string
): Promise<NotificationSubscription[]> {
	return Sentry.startSpan(
		{ name: 'getUserSubscriptions', op: 'db.query' },
		async (span) => {
			const results = await db
				.select()
				.from(notificationSubscriptions)
				.where(eq(notificationSubscriptions.userId, userId))
				.orderBy(desc(notificationSubscriptions.createdAt))
			span.setAttribute('subscription_count', results.length)
			return results
		}
	)
}

/** Fetches a single notification subscription by its primary key. */
export async function getSubscriptionById(
	id: number
): Promise<NotificationSubscription | undefined> {
	return Sentry.startSpan(
		{ name: 'getSubscriptionById', op: 'db.query', attributes: { id } },
		async () => {
			const result = await db
				.select()
				.from(notificationSubscriptions)
				.where(eq(notificationSubscriptions.id, id))
				.limit(1)
			return result[0]
		}
	)
}

/** Creates a new notification subscription and returns the inserted record. */
export async function createSubscription(
	data: NewNotificationSubscription
): Promise<NotificationSubscription> {
	return Sentry.startSpan(
		{ name: 'createSubscription', op: 'db.query' },
		async () => {
			const result = await db
				.insert(notificationSubscriptions)
				.values(data)
				.returning()
			return result[0]
		}
	)
}

/** Updates a subscription owned by the given user; returns the updated record or undefined if not found. */
export async function updateSubscription(
	id: number,
	userId: string,
	data: Partial<NewNotificationSubscription>
): Promise<NotificationSubscription | undefined> {
	return Sentry.startSpan(
		{ name: 'updateSubscription', op: 'db.query', attributes: { id } },
		async () => {
			const result = await db
				.update(notificationSubscriptions)
				.set({ ...data, updatedAt: new Date() })
				.where(
					and(
						eq(notificationSubscriptions.id, id),
						eq(notificationSubscriptions.userId, userId)
					)
				)
				.returning()
			return result[0]
		}
	)
}

/** Deletes a subscription owned by the given user; returns true if deleted, false if not found. */
export async function deleteSubscription(
	id: number,
	userId: string
): Promise<boolean> {
	return Sentry.startSpan(
		{ name: 'deleteSubscription', op: 'db.query', attributes: { id } },
		async () => {
			const result = await db
				.delete(notificationSubscriptions)
				.where(
					and(
						eq(notificationSubscriptions.id, id),
						eq(notificationSubscriptions.userId, userId)
					)
				)
				.returning({ id: notificationSubscriptions.id })
			return result.length > 0
		}
	)
}

/** Returns all subscriptions due for notification by throttle period.
 * A subscription is "due" if lastNotifiedAt is NULL or older than the throttle window. */
export async function getSubscriptionsDue(
	throttlePeriod: ThrottlePeriodValue
): Promise<NotificationSubscription[]> {
	return Sentry.startSpan(
		{
			name: 'getSubscriptionsDue',
			op: 'db.query',
			attributes: { throttlePeriod },
		},
		async (span) => {
			const now = Date.now()
			const windowMs: Record<ThrottlePeriodValue, number> = {
				hourly: 60 * 60 * 1000,
				daily: 24 * 60 * 60 * 1000,
				weekly: 7 * 24 * 60 * 60 * 1000,
			}
			const cutoff = new Date(now - windowMs[throttlePeriod])
			const results = await db
				.select()
				.from(notificationSubscriptions)
				.where(
					and(
						eq(notificationSubscriptions.throttlePeriod, throttlePeriod),
						sql`(${notificationSubscriptions.lastNotifiedAt} IS NULL OR ${notificationSubscriptions.lastNotifiedAt} < ${cutoff.getTime() / 1000})`
					)
				)
			span.setAttribute('subscription_count', results.length)
			return results
		}
	)
}

/** Updates lastNotifiedAt (and updatedAt) for a subscription. */
export async function markSubscriptionNotified(
	id: number,
	notifiedAt: Date = new Date()
): Promise<void> {
	await Sentry.startSpan(
		{ name: 'markSubscriptionNotified', op: 'db.query', attributes: { id } },
		async () => {
			await db
				.update(notificationSubscriptions)
				.set({ lastNotifiedAt: notifiedAt, updatedAt: notifiedAt })
				.where(eq(notificationSubscriptions.id, id))
		}
	)
}
