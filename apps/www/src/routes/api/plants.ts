import { createFileRoute } from '@tanstack/solid-router'
import { z } from 'zod'
import { getAvailablePlants } from '@/data/queries'

const querySchema = z.object({
	limit: z.coerce.number().int().positive().max(100).default(10),
})

export const Route = createFileRoute('/api/plants')({
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
					const plants = await getAvailablePlants(parsed.data.limit)
					return Response.json(plants)
				} catch (error) {
					console.error('Failed to fetch plants:', error)
					return Response.json({ error: 'Failed to fetch plants' }, { status: 500 })
				}
			},
		},
	},
})
