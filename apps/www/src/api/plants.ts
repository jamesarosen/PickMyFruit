import { createServerFn } from '@tanstack/solid-start'

export const getAvailablePlants = createServerFn({ method: 'GET' })
	.inputValidator((limit: number = 3) => limit)
	.handler(async ({ data: limit }) => {
		const { getAvailablePlants: getAvailablePlantsFromDb } = await import(
			'@/data/queries'
		)
		return getAvailablePlantsFromDb(limit)
	})
