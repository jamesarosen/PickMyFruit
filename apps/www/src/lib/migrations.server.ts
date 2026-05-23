import { db } from '@/data/db.server'
import { Sentry } from '@/lib/sentry'
import { logger } from '@/lib/logger.server'
import { serverEnv } from '@/lib/env.server'

let pending: Promise<void> | undefined

/** Whether the running server should apply journal migrations at boot. */
export function shouldRunBootMigrations(): boolean {
	return (
		serverEnv.NODE_ENV === 'development' || serverEnv.NODE_ENV === 'production'
	)
}

/**
 * Applies pending journal migrations once per process (dev and production boot).
 *
 * Test environments migrate via Vitest globalSetup and Playwright setup instead.
 * Failures are reported to Sentry and terminate the process so deploys fail closed.
 */
export function runMigrations(): Promise<void> {
	if (!shouldRunBootMigrations()) return Promise.resolve()

	pending ??= (async () => {
		const start = Date.now()
		logger.info('Running database migrations')
		const { migrate } = await import('drizzle-orm/libsql/migrator')
		await migrate(db, { migrationsFolder: './drizzle' })
		logger.info({ elapsed: Date.now() - start }, 'Database migrations complete')
	})().catch((err) => {
		Sentry.captureException(err)
		pending = undefined
		process.exit(1)
	})

	return pending
}
