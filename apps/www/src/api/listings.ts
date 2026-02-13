import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
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

const getListingByIdValidator = z.coerce.number().int().positive()

/** Fetches a single available listing by ID, omitting sensitive fields. */
export const getPublicListingById = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((id: number) => getListingByIdValidator.parse(id))
	.handler(async ({ data: id }) => {
		const { getPublicListingById: query } = await import('@/data/queries')
		return query(id)
	})
