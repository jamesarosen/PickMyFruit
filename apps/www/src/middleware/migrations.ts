import { createMiddleware } from '@tanstack/solid-start'
import { runMigrations } from '@/lib/migrations'

/**
 * Ensures all database migrations have run before handling any request.
 * @todo address race condition before supporting multiple processes.
 * @see https://github.com/jamesarosen/PickMyFruit/issues/134
 */
export const migrationsMiddleware = createMiddleware().server(
	async ({ next }) => {
		try {
			await runMigrations()
		} catch {
			return Response.json(
				{ status: 'error', error: 'Service temporarily unavailable' },
				{ status: 503 }
			)
		}
		return next()
	}
)
