import { createFileRoute } from '@tanstack/solid-router'
import { z } from 'zod'
import { updateListingStatusSchema } from '@/lib/validation'
import { Sentry } from '@/lib/sentry'

const paramsSchema = z.object({
	id: z.coerce.number().int().positive(),
})

export const Route = createFileRoute('/api/listings/$id')({
	server: {
		handlers: {
			async PATCH({ request, params }) {
				const { auth } = await import('@/lib/auth')
				const { updateListingStatus } = await import('@/data/queries')

				const session = await auth.api.getSession({
					headers: request.headers,
				})

				if (!session?.user) {
					return Response.json({ error: 'Authentication required' }, { status: 401 })
				}

				const parsedParams = paramsSchema.safeParse(params)
				if (!parsedParams.success) {
					return Response.json({ error: 'Invalid listing ID' }, { status: 400 })
				}

				let body: unknown
				try {
					body = await request.json()
				} catch {
					return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
				}

				const parsed = updateListingStatusSchema.safeParse(body)
				if (!parsed.success) {
					const message = parsed.error.issues[0]?.message || 'Invalid status'
					return Response.json({ error: message }, { status: 400 })
				}

				const { id } = parsedParams.data
				const { status } = parsed.data

				try {
					const updated = await updateListingStatus(id, session.user.id, status)
					if (!updated) {
						return Response.json({ error: 'Not found' }, { status: 404 })
					}

					return Response.json({ success: true })
				} catch (error) {
					Sentry.captureException(error)
					return Response.json(
						{ error: 'Failed to update listing status' },
						{ status: 500 }
					)
				}
			},
		},
	},
})
