import { createFileRoute } from '@tanstack/solid-router'

const BMAC_URL = 'https://buymeacoffee.com/jamesarosen'

export const Route = createFileRoute('/support/go')({
	server: {
		handlers: {
			async GET({ request }) {
				const { Sentry } = await import('@/lib/sentry')
				const url = new URL(request.url)
				const from = url.searchParams.get('from') ?? 'direct'

				Sentry.metrics.count('support.go.click', 1, {
					attributes: { from },
				})

				return new Response(null, {
					status: 302,
					headers: { Location: BMAC_URL },
				})
			},
		},
	},
})
