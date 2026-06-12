import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'
import { NotFoundError } from '@/lib/user-error'
import { Sentry } from '@/lib/sentry'
import { updateListingSchema } from '@/lib/validation'
import { PRODUCE_STAND_SLUG } from '@/lib/produce-types'
import type { AddressFields, Listing } from '@/data/schema.server'
import type { OwnerListingView, VerifiedPublicListing } from '@/data/listing'

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

/**
 * Result of a {@link revealListingAddress} call. `gated` is not an error —
 * it's the expected response when the viewer hasn't yet verified their
 * email; the UI surfaces a "verify to reveal" affordance instead of an
 * address.
 */
export type RevealAddressResult =
	| { tag: 'revealed'; listing: VerifiedPublicListing }
	| { tag: 'gated'; reason: 'unauthenticated' | 'email_unverified' }

/**
 * Synchronously records an address reveal for the current viewer and
 * returns the precise address. POST semantics because it writes an
 * append-only row to `address_reveals`. Eligibility is `policy ===
 * on_verified_request` and the viewer is email-verified.
 */
export const revealListingAddress = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: unknown) => listingIdParamSchema.parse(data))
	.handler(async ({ data: id }): Promise<RevealAddressResult> => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const { logger } = await import('@/lib/logger.server')

		const session = await auth.api.getSession({ headers })

		const { getListingWithOwner, getPhotosForListing, recordAddressReveal } =
			await import('@/data/queries.server')
		const { toPublicListing, toVerifiedPublicListing } =
			await import('@/data/listing')

		const withOwner = await getListingWithOwner(id)
		if (!withOwner) throw new NotFoundError('Listing not found')
		const { listing, owner } = withOwner

		// Owners would never hit this path from the UI, but if they do, do not
		// record a reveal for themselves — return the address directly via the
		// verified shape so the caller gets a consistent payload.
		const isOwner = session?.user?.id === listing.userId

		const policy = listing.addressReleasePolicy

		Sentry.addBreadcrumb({
			category: 'address-release',
			type: 'info',
			message: 'reveal.requested',
			data: { listingId: id, policy },
		})

		Sentry.metrics.count('listing.address.reveal.click', 1, {
			attributes: { policy },
		})

		if (policy !== 'on_verified_request' && !isOwner) {
			// This endpoint is only for the verified-request path. Treat misuse as
			// "not allowed" rather than gated — the caller is on the wrong flow.
			throw new UserError(
				'NOT_ALLOWED',
				'This listing does not release its address automatically.'
			)
		}

		const verified = Boolean(session?.user?.emailVerified)

		Sentry.addBreadcrumb({
			category: 'address-release',
			type: 'info',
			message: 'auth.checked',
			data: { verified },
		})

		if (!session?.user) {
			Sentry.metrics.count('listing.address.reveal.gated', 1)
			Sentry.addBreadcrumb({
				category: 'address-release',
				type: 'info',
				message: 'reveal.gated',
			})
			logger.info(
				{
					listingId: id,
					userId: null,
					policy,
					verified: false,
					wroteEvent: false,
				},
				'address reveal gated: unauthenticated'
			)
			return { tag: 'gated', reason: 'unauthenticated' }
		}

		if (!verified && !isOwner) {
			Sentry.metrics.count('listing.address.reveal.gated', 1)
			Sentry.addBreadcrumb({
				category: 'address-release',
				type: 'info',
				message: 'reveal.gated',
			})
			logger.info(
				{
					listingId: id,
					userId: session.user.id,
					policy,
					verified: false,
					wroteEvent: false,
				},
				'address reveal gated: email unverified'
			)
			return { tag: 'gated', reason: 'email_unverified' }
		}

		const photos = await getPhotosForListing(id)
		const pub = toPublicListing(listing, photos)
		if (!pub) {
			throw new UserError(
				'INTERNAL_ERROR',
				'This listing has an invalid location and cannot be released.'
			)
		}

		if (!listing.address || (listing.lat === 0 && listing.lng === 0)) {
			Sentry.withScope((scope) => {
				scope.setFingerprint(['address-release', 'reveal', 'missing-address'])
				Sentry.captureMessage(
					'Address reveal requested on listing without a usable address',
					{ level: 'warning', extra: { listingId: id } }
				)
			})
		}

		let wroteEvent = false
		if (!isOwner) {
			try {
				await recordAddressReveal(session.user.id, id)
				wroteEvent = true
				Sentry.addBreadcrumb({
					category: 'address-release',
					type: 'info',
					message: 'reveal.event.written',
					data: { listingId: id },
				})
			} catch (error) {
				// Silent-failure detector: we still hand back the address, so the
				// member is unblocked, but losing the audit trail is significant
				// enough to capture.
				Sentry.withScope((scope) => {
					scope.setFingerprint(['address-release', 'reveal', 'event-write-failed'])
					Sentry.captureException(error, {
						extra: { listingId: id, userId: session.user.id },
					})
				})
				Sentry.captureMessage(
					'Address reveal event write failed; address still released',
					{ level: 'error', extra: { listingId: id, userId: session.user.id } }
				)
			}
		}

		Sentry.metrics.count('listing.address.revealed', 1, {
			attributes: { policy },
		})

		logger.info(
			{
				listingId: id,
				userId: session.user.id,
				policy,
				verified: true,
				wroteEvent,
			},
			'address reveal: address released'
		)

		// Steward identity is gated exactly like the address: only stands carry
		// the "Maintained by {name}" trust signal, and only verified/owner
		// viewers reach this branch.
		const isStand = listing.type === PRODUCE_STAND_SLUG

		return {
			tag: 'revealed',
			listing: toVerifiedPublicListing(
				pub,
				{
					address: listing.address,
					city: listing.city,
					state: listing.state,
					zip: listing.zip,
					country: listing.country,
					lat: listing.lat,
					lng: listing.lng,
				},
				isStand ? { stewardName: owner.name } : {}
			),
		}
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
