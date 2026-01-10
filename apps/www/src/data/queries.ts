import { db } from './db'
import {
	plants,
	owners,
	type Plant,
	type NewPlant,
	type Owner,
	type NewOwner,
} from './schema'
import { eq, desc } from 'drizzle-orm'

export async function getAvailablePlants(limit: number = 10): Promise<Plant[]> {
	return await db
		.select()
		.from(plants)
		.where(eq(plants.status, 'available'))
		.orderBy(desc(plants.createdAt))
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

export async function createListing(data: NewPlant): Promise<Plant> {
	const result = await db.insert(plants).values(data).returning()
	return result[0]
}
