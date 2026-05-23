import { createIsomorphicFn, createStart } from '@tanstack/solid-start'
import { bootReadyMiddleware } from '@/middleware/boot-ready'
import { mediaPreconnectMiddleware } from '@/middleware/media-preconnect'
import { securityHeadersMiddleware } from '@/middleware/security-headers'
import { tlsMiddleware } from '@/middleware/tls'

export const startInstance = createStart(() => ({
	requestMiddleware: [
		bootReadyMiddleware, // await server-boot migrations before handlers run
		tlsMiddleware, // May short-circuit with a redirect
		securityHeadersMiddleware, // Applies to all non-redirect responses
		mediaPreconnectMiddleware, // HTML only — Link preconnect to media CDN (Tigris)
	],
}))

// Start boot tasks (migrations, then resend-sync worker) when the server bundle loads.
// `createIsomorphicFn` keeps the dynamic `.server` import out of the client graph.
createIsomorphicFn()
	.client(() => undefined)
	.server(() => {
		void import('@/server-boot.server')
	})()
