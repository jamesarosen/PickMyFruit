import { db } from './db'
import { listings, type Listing, type NewListing } from './schema'
import { eq, desc, and, ne } from 'drizzle-orm'
import { ListingStatus, type ListingStatusValue } from '@/lib/validation'

export async function getAvailableListings(
	limit: number = 10
): Promise<Listing[]> {
	return await db
		.select()
		.from(listings)
		.where(eq(listings.status, ListingStatus.available))
		.orderBy(desc(listings.createdAt))
		.limit(limit)
}

export async function createListing(data: NewListing): Promise<Listing> {
	const result = await db.insert(listings).values(data).returning()
	return result[0]
}

export async function getUserListings(userId: string): Promise<Listing[]> {
	return await db
		.select()
		.from(listings)
		.where(eq(listings.userId, userId))
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

/** Public listing fields safe to expose to any visitor. */
export type PublicListing = Omit<Listing, 'address' | 'accessInstructions'>

/** Fetches a listing by ID, returning only public-safe fields. Excludes private listings. */
export async function getPublicListingById(
	id: number
): Promise<PublicListing | undefined> {
	const result = await db
		.select({
			id: listings.id,
			name: listings.name,
			type: listings.type,
			variety: listings.variety,
			status: listings.status,
			quantity: listings.quantity,
			harvestWindow: listings.harvestWindow,
			city: listings.city,
			state: listings.state,
			zip: listings.zip,
			lat: listings.lat,
			lng: listings.lng,
			h3Index: listings.h3Index,
			userId: listings.userId,
			notes: listings.notes,
			createdAt: listings.createdAt,
			updatedAt: listings.updatedAt,
		})
		.from(listings)
		.where(and(eq(listings.id, id), ne(listings.status, ListingStatus.private)))
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

/** Updates a listing's status, scoped to the owning user. */
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
