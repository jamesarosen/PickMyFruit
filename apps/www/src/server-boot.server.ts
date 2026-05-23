import { runMigrations } from '@/lib/migrations.server'
import { spawnResendSyncWorkerIfEnabled } from '@/lib/spawn-resend-sync.server'

/**
 * Runs once when the server bundle loads (dev and production).
 * Test uses Vitest/Playwright setup instead; see AGENTS.md.
 */
export const migrationsReady = runMigrations().then(() => {
	spawnResendSyncWorkerIfEnabled()
})
