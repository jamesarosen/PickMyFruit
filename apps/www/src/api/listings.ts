import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware } from '@/lib/server-error-middleware'
import { Sentry } from '@/lib/sentry'
import type { AddressFields } from '@/data/schema'
import type { OwnerListingView } from '@/data/listing'

/** Fetches the current user's listings, or empty array if not authenticated. */
export const getMyListings = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.handler(async () => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			return [] as OwnerListingView[]
		}

		const { getUserListings } = await import('@/data/queries.server')
		const listings = await getUserListings(session.user.id)
		if (listings.length > 15) {
			Sentry.captureMessage('User has more than 15 listings', {
				level: 'warning',
				extra: {
					userId: session.user.id,
					listingCount: listings.length,
				},
			})
		}
		return listings
	})

/** Returns the current user's most recent address, or undefined. */
export const getMyLastAddress = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.handler(async (): Promise<AddressFields | undefined> => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		if (!session?.user) {
			return undefined
		}

		const { getUserLastAddress } = await import('@/data/queries.server')
		return getUserLastAddress(session.user.id)
	})

export const getAvailableListings = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((limit: number = 3) => limit)
	.handler(async ({ data: limit }) => {
		const { getAvailableListings: query } = await import('@/data/queries.server')
		return query(limit)
	})

const nearbyListingsSchema = z.object({
	lat: z.number(),
	lng: z.number(),
	limit: z.number().int().positive().max(50).default(12),
})

/** Fetches available listings ordered by proximity to a point. */
export const getNearbyListings = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((input: { lat: number; lng: number; limit?: number }) =>
		nearbyListingsSchema.parse(input)
	)
	.handler(async ({ data }) => {
		const { getNearbyListings: query } = await import('@/data/queries.server')
		return query(data.lat, data.lng, data.limit)
	})

const getListingByIdValidator = z.coerce.number().int().positive()

/** Fetches a single listing by ID, omitting sensitive fields. Excludes private listings. */
export const getPublicListingById = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((id: number) => getListingByIdValidator.parse(id))
	.handler(async ({ data: id }) => {
		const { getPublicListingById: query } = await import('@/data/queries.server')
		return query(id)
	})

/** Fetches a listing for the current viewer — owners see full data, others see public fields. */
export const getListingForViewer = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((id: number) => getListingByIdValidator.parse(id))
	.handler(async ({ data: id }) => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		const {
			getPublicListingById: getPublic,
			getListingById,
			getPhotosForListing,
		} = await import('@/data/queries.server')

		if (session?.user) {
			const listing = await getListingById(id)
			if (listing && listing.userId === session.user.id) {
				const photos = await getPhotosForListing(id)
				const ownerView: OwnerListingView = { ...listing, photos }
				return ownerView
			}
		}
		return getPublic(id)
	})
