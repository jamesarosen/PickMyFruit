import { createServerFn } from '@tanstack/solid-start'
import { errorMiddleware } from '@/lib/server-error-middleware'

export const getAvailablePlants = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((limit: number = 3) => limit)
	.handler(async ({ data: limit }) => {
		const { getAvailablePlants: getAvailablePlantsFromDb } = await import(
			'@/data/queries'
		)
		return getAvailablePlantsFromDb(limit)
	})
