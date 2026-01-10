import { createFileRoute } from '@tanstack/solid-router'
import { auth } from '@/lib/auth'

// @ts-expect-error - route types not yet generated for catch-all route
export const Route = createFileRoute('/api/auth/$')({
	server: {
		handlers: {
			GET: ({ request }) => auth.handler(request),
			POST: ({ request }) => auth.handler(request),
		},
	},
})
