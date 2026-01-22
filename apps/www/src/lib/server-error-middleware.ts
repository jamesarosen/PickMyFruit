import { createMiddleware } from '@tanstack/solid-start'
import { Sentry } from './sentry'

/**
 * A user-safe error that can be thrown from server functions.
 * The message will be shown to the user.
 */
export class UserError extends Error {
	public readonly code: string

	constructor(code: string, message: string) {
		super(message)
		this.name = 'UserError'
		this.code = code
	}
}

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
