import { createFileRoute, redirect } from '@tanstack/solid-router'
import { z } from 'zod'
import { Sentry } from '@/lib/sentry'
import { SIGNATURE_MAX_AGE_MS } from '@/lib/hmac'

const paramsSchema = z.object({
	id: z.coerce.number().int().positive(),
})

const querySchema = z.object({
	nonce: z.string().min(1),
	ts: z.coerce.number().int().positive(),
	sig: z.string().min(1),
})

export const Route = createFileRoute('/api/listings/$id/unavailable')({
	server: {
		handlers: {
			async GET({ request, params }) {
				const { verifySignature } = await import('@/lib/hmac')
				const { markListingUnavailable } = await import('@/data/queries')

				const parsedParams = paramsSchema.safeParse(params)
				if (!parsedParams.success) {
					return Response.json({ error: 'Invalid listing ID' }, { status: 400 })
				}

				const url = new URL(request.url)
				const parsedQuery = querySchema.safeParse({
					nonce: url.searchParams.get('nonce'),
					ts: url.searchParams.get('ts'),
					sig: url.searchParams.get('sig'),
				})

				if (!parsedQuery.success) {
					return Response.json(
						{ error: 'Missing nonce, ts, or sig parameter' },
						{ status: 400 }
					)
				}

				const { id } = parsedParams.data
				const { nonce, ts, sig } = parsedQuery.data
				const age = Date.now() - ts

				if (age > SIGNATURE_MAX_AGE_MS) {
					Sentry.captureMessage('Expired HMAC link accessed', {
						level: 'warning',
						extra: { listingId: id, ageMs: age },
					})
					return Response.json(
						{
							error:
								'This link has expired. Please visit your listings page to update status.',
						},
						{ status: 410 }
					)
				}

				if (!verifySignature(id, nonce, ts, sig)) {
					Sentry.captureMessage('Invalid HMAC signature', {
						level: 'warning',
						extra: { listingId: id, ageMs: age },
					})
					return Response.json({ error: 'Invalid signature' }, { status: 403 })
				}

				try {
					const updated = await markListingUnavailable(id)
					if (!updated) {
						return Response.json({ error: 'Listing not found' }, { status: 404 })
					}

					throw redirect({
						to: '/listings/mine',
						search: { marked: 'unavailable' },
					})
				} catch (error) {
					if (
						error instanceof Response ||
						(error as Record<string, unknown>)?.isRedirect
					) {
						throw error
					}
					Sentry.captureException(error)
					return Response.json(
						{ error: 'Failed to update listing' },
						{ status: 500 }
					)
				}
			},
		},
	},
})
