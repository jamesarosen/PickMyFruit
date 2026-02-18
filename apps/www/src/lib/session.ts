import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import type { Session } from './auth'
import { Sentry } from './sentry'

/**
 * Fetches the current session from Better Auth via request headers.
 *
 * Always runs server-side: directly during SSR, via RPC during
 * client-side navigation. Returns null if not authenticated or on error.
 */
export const getSession = createServerFn({ method: 'GET' }).handler(
	async (): Promise<Session | null> => {
		try {
			const headers = getRequestHeaders()
			const { auth } = await import('./auth')
			return await auth.api.getSession({ headers })
		} catch (error) {
			// Treat auth failures as unauthenticated so pages degrade gracefully
			// rather than showing error boundaries for transient auth issues.
			Sentry.captureException(error)
			return null
		}
	}
)
