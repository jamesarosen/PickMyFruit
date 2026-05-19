import { createIsomorphicFn, createStart } from '@tanstack/solid-start'
import { mediaPreconnectMiddleware } from '@/middleware/media-preconnect'
import { migrationsMiddleware } from '@/middleware/migrations'
import { securityHeadersMiddleware } from '@/middleware/security-headers'
import { tlsMiddleware } from '@/middleware/tls'

export const startInstance = createStart(() => ({
	requestMiddleware: [
		migrationsMiddleware, // schema must exist before any handler runs
		tlsMiddleware, // May short-circuit with a redirect
		securityHeadersMiddleware, // Applies to all non-redirect responses
		mediaPreconnectMiddleware, // HTML only — Link preconnect to media CDN (Tigris)
	],
}))

// Boot-time side effect: when RESEND_SYNC_WORKER_ENABLED=true, spawn the
// resend-worker as a child of this Node process so a single Fly machine
// hosts both. Gated off by default; in prod fly.toml sets it to 'true'.
//
// `createIsomorphicFn` keeps the dynamic `.server` import inside the
// server-only branch, satisfying TanStack Start's import-protection plugin
// (which forbids any client-graph file from importing `*.server.*`, even
// dynamically). The client branch is a no-op.
const bootResendWorker = createIsomorphicFn()
	.client(() => undefined)
	.server(() => {
		void import('@/lib/spawn-resend-worker.server').then((m) => {
			m.spawnResendWorkerIfEnabled()
		})
	})

bootResendWorker()
