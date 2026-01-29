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

export const getListingById = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((id: number) => getListingByIdValidator.parse(id))
	.handler(async ({ data: id }) => {
		const { getListingForInquiry } = await import('@/data/queries')
		return getListingForInquiry(id)
	})
