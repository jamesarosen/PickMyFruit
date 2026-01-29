import { createServerFn } from '@tanstack/solid-start'
import { errorMiddleware } from '@/lib/server-error-middleware'

export const getAvailableListings = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((limit: number = 3) => limit)
	.handler(async ({ data: limit }) => {
		const { getAvailableListings: getAvailableListingsFromDb } = await import(
			'@/data/queries'
		)
		return getAvailableListingsFromDb(limit)
	})
