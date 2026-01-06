import { createServerFn } from '@tanstack/solid-start'
import { getAvailablePlants as getAvailablePlantsFromDb } from '@/data/queries'

export const getAvailablePlants = createServerFn({ method: 'GET' })
	.inputValidator((limit: number = 3) => limit)
	.handler(({ data: limit }) => getAvailablePlantsFromDb(limit))
