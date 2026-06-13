import {
	createCsrfMiddleware,
	createIsomorphicFn,
	createStart,
} from '@tanstack/solid-start'
import { bootReadyMiddleware } from '@/middleware/boot-ready'
import { mediaPreconnectMiddleware } from '@/middleware/media-preconnect'
import { securityHeadersMiddleware } from '@/middleware/security-headers'
import { tlsMiddleware } from '@/middleware/tls'

/** Rejects cross-site requests to server functions, which are same-origin RPC endpoints. */
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
	requestMiddleware: [
		bootReadyMiddleware, // await server-boot migrations before handlers run
		tlsMiddleware, // May short-circuit with a redirect
		csrfMiddleware, // Rejects cross-site server-function requests before they run
		securityHeadersMiddleware, // Applies to all non-redirect responses
		mediaPreconnectMiddleware, // HTML only — Link preconnect to media CDN (Tigris)
	],
}))

// Start boot tasks (migrations, then the kokoto runtime) when the server bundle loads.
// `createIsomorphicFn` keeps the dynamic `.server` import out of the client graph.
createIsomorphicFn()
	.client(() => undefined)
	.server(() => {
		void import('@/server-boot.server')
	})()
