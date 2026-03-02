import { createFileRoute } from '@tanstack/solid-router'
import { sql } from 'drizzle-orm'
import { db } from '@/data/db'
import { Sentry } from '@/lib/sentry'

export const Route = createFileRoute('/api/health')({
	server: {
		handlers: {
			async GET() {
				try {
					await db.run(sql`SELECT 1`)
				} catch (error) {
					Sentry.captureException(error)
					return Response.json(
						{ status: 'error', error: 'db unavailable' },
						{ status: 503 }
					)
				}

				return Response.json({
					status: 'ok',
					timestamp: new Date().toISOString(),
				})
			},
		},
	},
})
