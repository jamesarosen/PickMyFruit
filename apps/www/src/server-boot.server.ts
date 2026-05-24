import { runMigrations } from '@/lib/migrations.server'
import { startKokotoRuntime } from '@/lib/kokoto-boot.server'
import { spawnResendSyncWorkerIfEnabled } from '@/lib/spawn-resend-sync.server'

/**
 * Runs once when the server bundle loads. Migrations run only when
 * `RUN_MIGRATIONS_ON_BOOT` is set; test servers leave it off.
 */
export const migrationsReady = runMigrations()
	.then(() => startKokotoRuntime())
	.then(() => {
		spawnResendSyncWorkerIfEnabled()
	})
