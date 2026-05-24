import { runMigrations } from '@/lib/migrations.server'
import {
	startKokotoRuntime,
	stopKokotoRuntime,
} from '@/lib/kokoto/runtime.server'
import { spawnResendSyncWorkerIfEnabled } from '@/lib/spawn-resend-sync.server'

let shutdownRegistered = false

function registerShutdown(): void {
	if (shutdownRegistered) return
	shutdownRegistered = true
	for (const signal of ['SIGTERM', 'SIGINT'] as const) {
		process.once(signal, () => {
			void stopKokotoRuntime().finally(() => process.exit(0))
		})
	}
}

/**
 * Runs once when the server bundle loads. Migrations run only when
 * `RUN_MIGRATIONS_ON_BOOT` is set; test servers leave it off.
 */
export const migrationsReady = runMigrations().then(async () => {
	await startKokotoRuntime()
	registerShutdown()
	spawnResendSyncWorkerIfEnabled()
})
