import { db } from './db'
import { plants, type Plant } from './schema'
import { eq, desc } from 'drizzle-orm'

export async function getAvailablePlants(limit: number = 10): Promise<Plant[]> {
	const safeLimit = Math.min(Math.max(1, limit), 100)
	return await db
		.select()
		.from(plants)
		.where(eq(plants.status, 'available'))
		.orderBy(desc(plants.createdAt))
		.limit(safeLimit)
}
