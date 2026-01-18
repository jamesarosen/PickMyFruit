import { db } from './db'
import {
	listings,
	owners,
	inquiries,
	user,
	type Listing,
	type NewListing,
	type Owner,
	type NewOwner,
	type Inquiry,
	type NewInquiry,
} from './schema'
import { eq, desc, and, isNull, gt } from 'drizzle-orm'
import { ListingStatus, type ListingStatusValue } from '@/lib/validation'

export async function getAvailableListings(
	limit: number = 10
): Promise<Listing[]> {
	return await db
		.select()
		.from(listings)
		.where(
			and(eq(listings.status, ListingStatus.available), isNull(listings.deletedAt))
		)
		.orderBy(desc(listings.createdAt))
		.limit(limit)
}

export async function findOrCreateOwner(
	data: Omit<NewOwner, 'id' | 'createdAt' | 'updatedAt'>
): Promise<Owner> {
	const existing = await db
		.select()
		.from(owners)
		.where(eq(owners.email, data.email))
		.limit(1)

	if (existing.length > 0) {
		return existing[0]
	}

	const result = await db.insert(owners).values(data).returning()
	return result[0]
}

export async function createListing(data: NewListing): Promise<Listing> {
	const result = await db.insert(listings).values(data).returning()
	return result[0]
}

export async function getUserListings(userId: string): Promise<Listing[]> {
	return await db
		.select()
		.from(listings)
		.where(and(eq(listings.userId, userId), isNull(listings.deletedAt)))
		.orderBy(desc(listings.createdAt))
}

export async function getListingById(id: number): Promise<Listing | undefined> {
	const result = await db
		.select()
		.from(listings)
		.where(eq(listings.id, id))
		.limit(1)
	return result[0]
}

export async function deleteListingById(
	id: number,
	userId: string
): Promise<boolean> {
	const result = await db
		.delete(listings)
		.where(and(eq(listings.id, id), eq(listings.userId, userId)))
		.returning({ id: listings.id })

	return result.length > 0
}

// ============================================================================
// Inquiry Functions
// ============================================================================

export async function createInquiry(data: NewInquiry): Promise<Inquiry> {
	const result = await db.insert(inquiries).values(data).returning()
	return result[0]
}

export async function markInquiryEmailSent(id: number): Promise<void> {
	await db
		.update(inquiries)
		.set({ emailSentAt: new Date() })
		.where(eq(inquiries.id, id))
}

export async function hasRecentInquiry(
	gleanerId: string,
	listingId: number
): Promise<boolean> {
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

export async function getListingWithOwner(id: number): Promise<
	| {
			listing: Listing
			owner: { id: string; name: string; email: string }
	  }
	| undefined
> {
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

export async function getListingForInquiry(
	id: number
): Promise<Listing | undefined> {
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

export async function updateListingStatus(
	id: number,
	userId: string,
	status: ListingStatusValue
): Promise<boolean> {
	const result = await db
		.update(listings)
		.set({ status, updatedAt: new Date() })
		.where(and(eq(listings.id, id), eq(listings.userId, userId)))
		.returning({ id: listings.id })
	return result.length > 0
}

export async function getUserById(
	id: string
): Promise<{ name: string; email: string } | undefined> {
	const result = await db
		.select({ name: user.name, email: user.email })
		.from(user)
		.where(eq(user.id, id))
		.limit(1)
	return result[0]
}

/**
 * Mark a listing as unavailable (used by HMAC-signed one-click URL)
 * Does not require userId since it's authenticated via HMAC signature
 */
export async function markListingUnavailable(id: number): Promise<boolean> {
	const result = await db
		.update(listings)
		.set({ status: ListingStatus.unavailable, updatedAt: new Date() })
		.where(and(eq(listings.id, id), isNull(listings.deletedAt)))
		.returning({ id: listings.id })
	return result.length > 0
}
