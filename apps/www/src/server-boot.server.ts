import { startRuntime, stopRuntime } from '@/lib/kokoto.server'
import { runMigrations } from '@/lib/migrations.server'
import { Sentry } from '@/lib/sentry'

let shutdownRegistered = false

/**
 * Register one-shot SIGTERM/SIGINT handlers that stop the kokoto runtime
 * before exiting. In-flight workflow steps either finish or replay on the
 * next boot (at-least-once).
 */
function registerShutdown(): void {
	if (shutdownRegistered) return
	shutdownRegistered = true
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.once(signal, () => {
			void stopRuntime()
				.catch((err) => {
					Sentry.captureException(err)
				})
				.finally(() => process.exit(0))
		})
	}
}

/**
 * Runs once when the server bundle loads. Order is fixed:
 *   migrations → kokoto runtime.start().
 * Migrations run only when `RUN_MIGRATIONS_ON_BOOT` is set; test servers
 * leave it off.
 */
export const migrationsReady = runMigrations().then(async () => {
	try {
		await startRuntime()
		registerShutdown()
	} catch (err) {
		Sentry.captureException(err)
	}
})
