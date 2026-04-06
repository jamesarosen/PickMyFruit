import { createFileRoute } from '@tanstack/solid-router'
import { z } from 'zod'
import { Sentry } from '@/lib/sentry'

const paramsSchema = z.object({
	id: z.coerce.number().int().positive(),
	photoId: z.coerce.number().int().positive(),
})

export const Route = createFileRoute('/api/listings/$id/photos/$photoId')({
	server: {
		handlers: {
			async DELETE({ request, params }) {
				try {
					const { auth } = await import('@/lib/auth.server')
					const session = await auth.api.getSession({
						headers: request.headers,
					})
					if (!session?.user) {
						return Response.json(
							{ error: 'Authentication required' },
							{ status: 401 }
						)
					}

					const parsed = paramsSchema.safeParse(params)
					if (!parsed.success) {
						return Response.json({ error: 'Invalid photo ID' }, { status: 400 })
					}

					const { photoId } = parsed.data
					const { deleteListingPhoto } = await import('@/data/queries.server')
					const deleted = await deleteListingPhoto(photoId, session.user.id)
					if (!deleted) {
						return Response.json({ error: 'Not found' }, { status: 404 })
					}

					const pathWithinDir = deleted.rawKey.startsWith('raw/')
						? deleted.rawKey.slice(4)
						: null
					if (!pathWithinDir) {
						throw new Error('Unexpected raw key format')
					}

					const { storage } = await import('@/lib/storage.server')
					await Promise.all([
						storage.delete('raw', pathWithinDir),
						storage.delete('pub', pathWithinDir),
					])

					return new Response(null, { status: 204 })
				} catch (error) {
					Sentry.withScope((scope) => {
						scope.setTag('handler', 'DELETE /api/listings/$id/photos/$photoId')
						Sentry.captureException(error)
					})
					return Response.json({ error: 'Failed to remove photo' }, { status: 500 })
				}
			},
		},
	},
})
