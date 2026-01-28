import { redirect } from '@tanstack/solid-router'
import { createMiddleware } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { auth } from '@/lib/auth'

/**
 * Require authentication
 */
export const authMiddleware = createMiddleware().server(async ({ next }) => {
	const headers = getRequestHeaders()
	const session = await auth.api.getSession({ headers })
	if (!session) {
		throw redirect({ to: '/login' })
	}
	return await next()
})
