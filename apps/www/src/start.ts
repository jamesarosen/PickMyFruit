import { createStart } from '@tanstack/solid-start'
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
// resend-sync worker as a child of this Node process so a single Fly machine
// hosts both. Gated off by default; in prod fly.toml sets it to 'true'. Server
// only — the dynamic import keeps the .server module out of the client graph
// and the `typeof window` check defends against accidental SSR re-entry on the
// browser (which can't happen, but cheap insurance).
if (typeof window === 'undefined') {
	void import('@/lib/spawn-resend-sync.server').then((m) => {
		m.spawnResendSyncWorkerIfEnabled()
	})
}
