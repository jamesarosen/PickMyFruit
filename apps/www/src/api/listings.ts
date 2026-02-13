import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware } from '@/lib/server-error-middleware'
import type { Listing } from '@/data/schema'

/** Fetches the current user's listings, or empty array if not authenticated. */
export const getMyListings = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.handler(async () => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			return [] as Listing[]
		}

		const { getUserListings } = await import('@/data/queries')
		return getUserListings(session.user.id)
	})

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

/** Fetches a single listing by ID, omitting sensitive fields. Excludes private listings. */
export const getPublicListingById = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((id: number) => getListingByIdValidator.parse(id))
	.handler(async ({ data: id }) => {
		const { getPublicListingById: query } = await import('@/data/queries')
		return query(id)
	})
