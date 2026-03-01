import { createStart } from '@tanstack/solid-start'
import { securityHeadersMiddleware } from '@/middleware/security-headers'
import { tlsMiddleware } from '@/middleware/tls'

export const startInstance = createStart(() => ({
	requestMiddleware: [
		tlsMiddleware, // Must run first: may short-circuit with a redirect
		securityHeadersMiddleware, // Applies to all non-redirect responses
	],
}))
