import { db } from '@/data/db.server'
import { Sentry } from '@/lib/sentry'
import { logger } from '@/lib/logger.server'
import { serverEnv } from '@/lib/env.server'

let pending: Promise<void> | undefined

/**
 * Applies pending journal migrations once per process when
 * {@link serverEnv.RUN_MIGRATIONS_ON_BOOT} is enabled.
 *
 * Failures are reported to Sentry and terminate the process so deploys fail closed.
 */
export function runMigrations(): Promise<void> {
	if (!serverEnv.RUN_MIGRATIONS_ON_BOOT) return Promise.resolve()

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
