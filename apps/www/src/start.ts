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
