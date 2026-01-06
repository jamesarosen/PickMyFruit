import { db } from './db'
import { plants, type Plant } from './schema'
import { eq, desc } from 'drizzle-orm'

export async function getAvailablePlants(limit: number = 10): Promise<Plant[]> {
	return await db
		.select()
		.from(plants)
		.where(eq(plants.status, 'available'))
		.orderBy(desc(plants.createdAt))
		.limit(limit)
}
