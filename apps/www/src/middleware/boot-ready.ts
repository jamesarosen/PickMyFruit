import { Sentry } from '@/lib/sentry'
import { createMiddleware } from '@tanstack/solid-start'

/**
 * Gates requests until {@link migrationsReady} from server-boot has finished.
 * Migrations run once at boot, not per request.
 */
export const bootReadyMiddleware = createMiddleware().server(
	async ({ next }) => {
		try {
			const { migrationsReady } = await import('@/server-boot.server')
			await migrationsReady
		} catch (e) {
			Sentry.captureException(e)
			return Response.json(
				{ status: 'error', error: 'Service temporarily unavailable' },
				{ status: 503 }
			)
		}
		return next()
	}
)
