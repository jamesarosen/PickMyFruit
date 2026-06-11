import { createFileRoute } from '@tanstack/solid-router'
import { z } from 'zod'
import { latLngToCell } from 'h3-js'
import { createListingSchema } from '@/lib/validation'
import { H3_RESOLUTIONS } from '@/lib/h3-resolutions'
import { Sentry } from '@/lib/sentry'
import { produceTypes, PRODUCE_STAND_SLUG } from '@/lib/produce-types'

const querySchema = z.object({
	limit: z.coerce.number().int().positive().max(100).default(10),
})

export const Route = createFileRoute('/api/listings')({
	server: {
		handlers: {
			async GET({ request }) {
				const url = new URL(request.url)
				const parsed = querySchema.safeParse({
					limit: url.searchParams.get('limit') ?? undefined,
				})

				if (!parsed.success) {
					return Response.json({ error: parsed.error.flatten() }, { status: 400 })
				}

				try {
					const { getAvailableListings } = await import('@/data/queries.server')
					const listings = await getAvailableListings(parsed.data.limit)
					return Response.json(listings)
				} catch (error) {
					Sentry.captureException(error)
					return Response.json(
						{ error: 'Failed to fetch listings' },
						{ status: 500 }
					)
				}
			},
			async POST({ request }) {
				// Dynamic imports to avoid bundling server-only code for browser
				const { auth } = await import('@/lib/auth.server')
				const { createListing } = await import('@/data/queries.server')

				// Require authentication
				const session = await auth.api.getSession({
					headers: request.headers,
				})

				if (!session?.user) {
					return Response.json({ error: 'Authentication required' }, { status: 401 })
				}

				let body: unknown
				try {
					body = await request.json()
				} catch {
					return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
				}

				// Validate body — client supplies lat/lng from browser geocoding
				const parsed = createListingSchema.safeParse(body)
				if (!parsed.success) {
					return Response.json({ error: parsed.error.flatten() }, { status: 400 })
				}

				const { lat, lng, ...formData } = parsed.data

				// Re-derive h3Index server-side; never trust a client-supplied cell index
				const h3Index = latLngToCell(lat, lng, H3_RESOLUTIONS.STORAGE)

				// Create the listing
				try {
					const listing = await createListing({
						name:
							produceTypes.find((p) => p.slug === formData.type)
								?.nameSingularTitleCase ?? formData.type,
						type: formData.type,
						harvestWindow: formData.harvestWindow,
						address: formData.address,
						city: formData.city,
						state: formData.state,
						zip: formData.zip || null,
						lat,
						lng,
						h3Index,
						userId: session.user.id,
						notes: formData.notes || null,
						status: 'available',
						addressReleasePolicy: formData.addressReleasePolicy,
						// Only stands accept drop-offs; the form omits the flag otherwise.
						acceptsDropOffs:
							formData.type === PRODUCE_STAND_SLUG ? formData.acceptsDropOffs : false,
					})

					return Response.json(listing, { status: 201 })
				} catch (error) {
					Sentry.captureException(error)
					return Response.json(
						{ error: 'Failed to create listing' },
						{ status: 500 }
					)
				}
			},
		},
	},
})
