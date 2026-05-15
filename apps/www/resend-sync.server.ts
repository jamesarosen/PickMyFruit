/**
 * resend-sync worker entrypoint.
 *
 * Runs as a separate process alongside the web app on the same Fly machine.
 * Compile with: pnpm build:resend-sync
 * Run with: node .output/server/resend-sync.mjs
 *
 * Build tool: esbuild rather than vite build, because vite expects an HTML
 * entry and pulls in the Solid plugin chain we do not need. esbuild's --define
 * flags inline the build-time import.meta.env.* values that src/lib/env.ts
 * and src/lib/sentry.ts read.
 *
 * Sentry: @sentry/solidstart's `node` export condition resolves to @sentry/node
 * under esbuild --platform=node, and tree-shaking removes the Solid-specific
 * exports the worker never imports. The Dockerfile passes the same
 * VITE_SENTRY_* build args the web build uses, so Sentry runs end-to-end in
 * production. The package.json `build:resend-sync` script stubs those values
 * for local builds, where Sentry is off by default.
 *
 * If src/lib/env.ts ever gains import.meta.env.* vars this worker should
 * respect, add matching --define flags to both the Dockerfile build step and
 * the package.json `build:resend-sync` script.
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
