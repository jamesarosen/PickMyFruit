import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'
import { NotFoundError } from '@/lib/user-error'
import { Sentry } from '@/lib/sentry'
import { updateListingSchema } from '@/lib/validation'
import type { AddressFields, Listing } from '@/data/schema.server'
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

/**
 * Strict positive integer listing id from route params or RPC input; `.parse`
 * throws {@link NotFoundError} when the value is malformed (TanStack-compatible
 * not-found; see `notFound()` in Router docs).
 */
export const listingIdParamSchema = z.coerce
	.string()
	.regex(/^\d+$/)
	.transform((s) => Number.parseInt(s, 10))
	.pipe(z.number().int().positive())
	.catch(() => {
		throw new NotFoundError('Listing not found')
	})

/** Fetches a single listing by ID, omitting sensitive fields. Excludes private listings. */
export const getPublicListingById = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((id: unknown) => listingIdParamSchema.parse(id))
	.handler(async ({ data: id }) => {
		const { getPublicListingById: query } = await import('@/data/queries.server')
		return query(id)
	})

/** Fetches a listing for the current viewer — owners see full data, others see public fields. */
export const getListingForViewer = createServerFn({ method: 'GET' })
	.middleware([errorMiddleware])
	.inputValidator((id: unknown) => listingIdParamSchema.parse(id))
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

/** Updates any combination of listing fields for the authenticated owner. */
export const updateListing = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: unknown) => updateListingSchema.parse(data))
	.handler(async ({ data }): Promise<Listing> => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })
		if (!session?.user)
			throw new UserError('AUTH_REQUIRED', 'Authentication required')
		const { id, clientUpdatedAt, ...fields } = data
		const { updateListingById } = await import('@/data/queries.server')
		const result = await updateListingById(
			id,
			session.user.id,
			clientUpdatedAt,
			fields
		)
		if (result.tag === 'updated') return result.listing
		if (result.tag === 'conflict')
			throw new UserError(
				'CONFLICT',
				'This listing was updated elsewhere. Please refresh and try again.'
			)
		throw new UserError('NOT_FOUND', 'Listing not found')
	})
