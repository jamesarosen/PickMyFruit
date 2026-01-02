import { db } from './db'
import { plants, type Plant } from './schema'
import { eq } from 'drizzle-orm'

export async function getAvailablePlants(limit: number = 3): Promise<Plant[]> {
	return await db
		.select()
		.from(plants)
		.where(eq(plants.status, 'available'))
		.limit(limit)
}