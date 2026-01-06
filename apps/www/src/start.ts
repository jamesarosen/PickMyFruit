import { createStart } from '@tanstack/solid-start'
import { tlsMiddleware } from '@/middleware/tls'

export const startInstance = createStart(() => ({
	requestMiddleware: [tlsMiddleware],
}))
