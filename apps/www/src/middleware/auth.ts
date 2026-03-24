import { redirect } from '@tanstack/solid-router'
import { createMiddleware } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'

/**
 * Require authentication — redirects to /login with returnTo param
 */
export const authMiddleware = createMiddleware().server(
	async ({ next, request }) => {
		const { auth } = await import('@/lib/auth.server')
		const headers = getRequestHeaders()
		const session = await auth.api.getSession({ headers })
		if (!session) {
			const { pathname } = new URL(request.url)
			throw redirect({ to: '/login', search: { returnTo: pathname } })
		}
		return await next()
	}
)
