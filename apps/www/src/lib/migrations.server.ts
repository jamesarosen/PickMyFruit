import { migrate } from 'drizzle-orm/libsql/migrator'
import { db } from '@/data/db.server'
import { Sentry } from '@/lib/sentry'
import { logger } from '@/lib/logger.server'
import { serverEnv } from '@/lib/env.server'

let pending: Promise<void> | undefined
let failureCount = 0
const MAX_ATTEMPTS = 3

/**
 * Runs pending database migrations, retrying up to 3 times across requests.
 *
 * No-ops outside production — dev and test use `db:push`/`db:migrate` directly.
 * Failures are captured to Sentry. After MAX_ATTEMPTS the promise permanently
 * rejects so a broken migration does not hammer the database on every request.
 */
export function runMigrations(): Promise<void> {
	if (!serverEnv.MIGRATE_ON_REQUEST) return Promise.resolve()

	if (failureCount >= MAX_ATTEMPTS) {
		return Promise.reject(
			new Error(`Database migrations failed after ${MAX_ATTEMPTS} attempts`)
		)
	}

	pending ??= (async () => {
		const start = Date.now()
		logger.info('Running database migrations')
		await migrate(db, { migrationsFolder: './drizzle' })
		logger.info({ elapsed: Date.now() - start }, 'Database migrations complete')
	})().catch((err) => {
		Sentry.captureException(err)
		failureCount++
		pending = undefined
		throw err
	})

	return pending
}
