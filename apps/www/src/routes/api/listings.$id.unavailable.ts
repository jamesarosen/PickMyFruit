import { createFileRoute, redirect } from '@tanstack/solid-router'
import { z } from 'zod'

const paramsSchema = z.object({
	id: z.coerce.number().int().positive(),
})

const querySchema = z.object({
	nonce: z.string().min(1),
	sig: z.string().min(1),
})

export const Route = createFileRoute('/api/listings/$id/unavailable')({
	server: {
		handlers: {
			async GET({ request, params }) {
				// Dynamic imports to avoid bundling server-only code for browser
				const { verifySignature } = await import('@/lib/hmac')
				const { markListingUnavailable } = await import('@/data/queries')

				// Validate params
				const parsedParams = paramsSchema.safeParse(params)
				if (!parsedParams.success) {
					return Response.json({ error: 'Invalid listing ID' }, { status: 400 })
				}

				// Parse query params
				const url = new URL(request.url)
				const parsedQuery = querySchema.safeParse({
					nonce: url.searchParams.get('nonce'),
					sig: url.searchParams.get('sig'),
				})

				if (!parsedQuery.success) {
					return Response.json(
						{ error: 'Missing nonce or sig parameter' },
						{ status: 400 }
					)
				}

				const { id } = parsedParams.data
				const { nonce, sig } = parsedQuery.data

				// Verify HMAC signature
				if (!verifySignature(id, nonce, sig)) {
					return Response.json({ error: 'Invalid signature' }, { status: 403 })
				}

				// Mark listing as unavailable
				const updated = await markListingUnavailable(id)
				if (!updated) {
					return Response.json({ error: 'Listing not found' }, { status: 404 })
				}

				// Redirect to my listings page with success message
				throw redirect({
					to: '/listings/mine',
					search: { marked: 'unavailable' },
				})
			},
		},
	},
})
