/**
 * resend-sync worker entrypoint.
 *
 * Runs as a separate process alongside the web app on the same Fly machine.
 * Compile with: esbuild resend-sync.server.ts --bundle --platform=node --outfile=dist/resend-sync.js
 * Run with: node dist/resend-sync.js
 *
 * Required env vars:
 *   DATABASE_URL          — libsql file: URL (same as the web process)
 *   RESEND_SYNC_PROVIDER  — "resend" | "disabled" (default: "disabled")
 *   RESEND_API_KEY        — required when RESEND_SYNC_PROVIDER=resend
 *   RESEND_AUDIENCE_ID    — required when RESEND_SYNC_PROVIDER=resend
 *   RESEND_SYNC_POLL_MS   — poll interval in ms (default: 60000)
 */
import { drizzle } from 'drizzle-orm/libsql'
import { createClient } from '@libsql/client'
import * as schema from '@/data/schema.server'
import { parseWorkerEnv } from '@/lib/resend-sync-env.server'
import { createResendSyncClient } from '@/lib/resend-sync-client.server'
import { runWorker } from '@/lib/resend-sync-main.server'
import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'

const env = parseWorkerEnv(process.env)

const client = createClient({ url: env.DATABASE_URL })

await client.execute('PRAGMA busy_timeout = 5000')
await client.execute('PRAGMA journal_mode = WAL')
await client.execute('PRAGMA synchronous = NORMAL')

const db = drizzle(client, { schema })

const resendClient =
	env.sync.RESEND_SYNC_PROVIDER === 'resend'
		? createResendSyncClient(env.sync.RESEND_API_KEY, env.sync.RESEND_AUDIENCE_ID)
		: async () => ({ kind: 'ok' as const })

const controller = new AbortController()

function shutdown() {
	logger.info('resend-sync: received shutdown signal')
	controller.abort()
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

logger.info(
	{ pollMs: env.RESEND_SYNC_POLL_MS, provider: env.sync.RESEND_SYNC_PROVIDER },
	'resend-sync: starting'
)

try {
	await runWorker({
		db,
		resendClient,
		pollMs: env.RESEND_SYNC_POLL_MS,
		signal: controller.signal,
	})
} catch (err) {
	Sentry.captureException(err)
	process.exit(1)
} finally {
	client.close()
}
