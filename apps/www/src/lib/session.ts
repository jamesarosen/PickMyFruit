import { type BeforeLoadContextOptions } from '@tanstack/solid-router'
import { createIsomorphicFn } from '@tanstack/solid-start'
import type { Session } from './auth'

type Context = BeforeLoadContextOptions<
	any,
	any,
	any,
	any,
	any,
	any,
	any,
	any
>['context']

/**
 * Isomorphic session loader.
 *
 * - Server: extracts session from request headers via Better Auth server API
 * - Client: fetches session from Better Auth client API
 *
 * Use in beforeLoad to populate context.session for child routes:
 * ```ts
 * beforeLoad: async ({ context }) => {
 *   const session = await getSession(context)
 *   return { session }
 * }
 * ```
 */
export const getSession = createIsomorphicFn()
	.server(async (context: Context): Promise<Session | null> => {
		const headers = context?.context?.request?.headers
		if (!headers) {
			return null
		}
		const { auth } = await import('./auth')
		return auth.api.getSession({ headers })
	})
	.client(async (_context: Context): Promise<Session | null> => {
		const { authClient } = await import('./auth-client')
		const result = await authClient.getSession()
		return result.data ?? null
	})
