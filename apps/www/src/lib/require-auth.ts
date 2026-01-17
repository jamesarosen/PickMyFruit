import { redirect } from '@tanstack/solid-router'
import type { Session } from './auth'

type AuthContext = { session?: Session | null }

/**
 * Requires an authenticated session in route context.
 * Throws a redirect to /login if no session exists.
 *
 * Use in beforeLoad for protected route segments:
 * ```ts
 * beforeLoad: ({ context }) => requireAuth(context)
 * ```
 */
export function requireAuth(context: AuthContext): Session {
	if (!context.session?.user) {
		throw redirect({ to: '/login' })
	}
	return context.session
}
