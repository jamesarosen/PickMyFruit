import { createFileRoute } from '@tanstack/solid-router'
import { Sentry } from '@/lib/sentry'

export const Route = createFileRoute('/api/cron/notify')({
	server: {
		handlers: {
			async POST({ request }) {
				const { serverEnv } = await import('@/lib/env.server')
				const auth = request.headers.get('Authorization')
				const expected = `Bearer ${serverEnv.CRON_SECRET}`
				if (auth !== expected) {
					return Response.json({ error: 'Unauthorized' }, { status: 401 })
				}

				try {
					const { runAll } = await import('@/lib/notification-runner')
					const summaries = await runAll()
					const sent = summaries.reduce((n, s) => n + s.sent, 0)
					const skipped = summaries.reduce((n, s) => n + s.skipped, 0)
					const errors = summaries.reduce((n, s) => n + s.errors, 0)
					return Response.json({ sent, skipped, errors, summaries })
				} catch (error) {
					Sentry.captureException(error)
					return Response.json({ error: 'Notification run failed' }, { status: 500 })
				}
			},
		},
	},
})
