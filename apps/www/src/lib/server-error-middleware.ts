import { createMiddleware } from '@tanstack/solid-start'
import { setResponseStatus } from '@tanstack/solid-start/server'
import { Sentry } from './sentry'
export { UserError } from './user-error'
import { UserError } from './user-error'

/**
 * Middleware that captures exceptions server-side and converts them
 * to user-friendly errors before propagating to the client.
 *
 * - UserError instances pass through with their message intact
 * - Other errors are logged to Sentry and converted to a generic message
 */
export const errorMiddleware = createMiddleware({ type: 'function' }).server(
	async ({ next }) => {
		try {
			return await next()
		} catch (error) {
			if (error instanceof UserError) {
				if (error.status) {
					setResponseStatus(error.status)
				}
				throw error
			}

			Sentry.captureException(error)

			throw new UserError(
				'INTERNAL_ERROR',
				'An unexpected error occurred. Please try again.'
			)
		}
	}
)
