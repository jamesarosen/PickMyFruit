import { startRuntime } from '@/lib/kokoto.server'
import { runMigrations } from '@/lib/migrations.server'
import { spawnResendSyncWorkerIfEnabled } from '@/lib/spawn-resend-sync.server'
import { Sentry } from '@/lib/sentry'

/**
 * Runs once when the server bundle loads. Order is fixed:
 *   migrations → kokoto runtime.start() → legacy resend-sync child.
 * Migrations run only when `RUN_MIGRATIONS_ON_BOOT` is set; test servers
 * leave it off. Kokoto and the resend-sync spawn are always attempted.
 */
export const migrationsReady = runMigrations().then(async () => {
	try {
		await startRuntime()
	} catch (err) {
		Sentry.captureException(err)
	}
	spawnResendSyncWorkerIfEnabled()
})
