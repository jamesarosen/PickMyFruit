import { createFileRoute } from '@tanstack/solid-router'
import { getAvailablePlants } from '@/data/queries'

export const Route = createFileRoute('/api/plants')({
	server: {
		handlers: {
			async GET({ request }) {
				const url = new URL(request.url)
				const limitParam = url.searchParams.get('limit')
				const limit = limitParam ? parseInt(limitParam, 10) : 10

				try {
					const plants = await getAvailablePlants(limit)
					return Response.json(plants)
				} catch (error) {
					console.error('Failed to fetch plants:', error)
					return Response.json({ error: 'Failed to fetch plants' }, { status: 500 })
				}
			},
		},
	},
})
