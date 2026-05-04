import { createStart } from '@tanstack/solid-start'
import { mediaPreconnectMiddleware } from '@/middleware/media-preconnect'
import { migrationsMiddleware } from '@/middleware/migrations'
import { securityHeadersMiddleware } from '@/middleware/security-headers'
import { tlsMiddleware } from '@/middleware/tls'

// Run once at startup and then hourly — fire-and-forget so reconciliation
// never delays the first request. Each state transition in reconcilePendingPhotos
// is idempotent (conditional SQL UPDATE), so multiple Fly machines running
// concurrently will not corrupt data. They will, however, issue redundant
// headPhoto requests. Set max_machines = 1 for the www process group in
// fly.toml to prevent this.
async function runReconcile() {
	const { reconcilePendingPhotos } = await import('@/lib/reconcilePhotos.server')
	return reconcilePendingPhotos()
}
void runReconcile()
setInterval(() => void runReconcile(), 60 * 60_000)

export const startInstance = createStart(() => ({
	requestMiddleware: [
		migrationsMiddleware, // schema must exist before any handler runs
		tlsMiddleware, // May short-circuit with a redirect
		securityHeadersMiddleware, // Applies to all non-redirect responses
		mediaPreconnectMiddleware, // HTML only — Link preconnect to media CDN (Tigris)
	],
}))
