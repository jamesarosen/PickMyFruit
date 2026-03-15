import { createAuthClient } from 'better-auth/solid'
import { magicLinkClient } from 'better-auth/client/plugins'
import { Sentry } from './sentry'
import isNetworkError from 'is-network-error'
import { UserError } from './user-error'

const betterAuthClient = createAuthClient({
	plugins: [magicLinkClient()],
})

type BetterFetchErrorProps = {
	cause?: unknown
	code?: string
	message: string
	status: number
	statusText: string
}

class BetterFetchError extends UserError {
	readonly cause: unknown
	readonly status: number
	readonly statusText: string

	constructor({
		cause,
		code,
		message,
		status,
		statusText,
	}: BetterFetchErrorProps) {
		super(code ?? 'BetterFetchError', message)
		this.cause = cause
		this.status = status
		this.statusText = statusText
	}
}

/** BetterAuth API responses always have this shape. */
type BetterAuthResult = {
	data: unknown
	error: { status: number; statusText: string; [key: string]: unknown } | null
}

/**
 * Wraps a better-auth client method to catch network-level errors and
 * normalize API errors into safe user-facing messages.
 *
 * better-fetch@1.1.21 does not wrap its raw fetch() call in a try/catch,
 * so network failures (e.g. WebKit "Load failed") throw instead of returning
 * { error }. This wrapper catches those throws and returns { data: null, error }
 * so callers can use the normal { error } check.
 *
 * BetterAuth API errors (plain objects) may carry internal messages unsafe for
 * display (e.g. "validation_error — API key is invalid"). Other errors are
 * replaced with a `BetterFetchError`.
 *
 * Remove network-error workaround once better-fetch > 1.1.21 is released:
 * @see https://github.com/better-auth/better-fetch/issues/75
 */
function withNetworkErrorHandling<
	TReceiver extends Record<string, unknown>,
	TKey extends keyof TReceiver,
>(receiver: TReceiver, fn: TKey, errorMessage: string): TReceiver[TKey] {
	return (async (...args: unknown[]) => {
		try {
			const result = await (
				receiver[fn] as (...a: unknown[]) => Promise<BetterAuthResult>
			)(...args)
			if (result.error != null) {
				// Capture server errors (5xx) — not user errors like bad token (4xx)
				if (result.error.status >= 500) {
					Sentry.captureException(
						new Error(`Auth ${String(fn)} failed: ${result.error.statusText}`),
						{ extra: { status: result.error.status } }
					)
				}
				return {
					...result,
					error: new BetterFetchError({
						cause: result.error,
						message: errorMessage,
						status: result.error.status ?? 500,
						statusText: result.error.statusText ?? 'Internal Server Error',
					}),
				}
			}
			return result
		} catch (error) {
			Sentry.captureException(error)
			return {
				data: null,
				error: isNetworkError(error)
					? new BetterFetchError({
							cause: error,
							code: 'BetterFetchNetworkError',
							message: 'Network error. Trying again may help.',
							status: 599,
							statusText: 'Network Connect Timeout Error',
						})
					: new Error(errorMessage),
			}
		}
	}) as TReceiver[TKey]
}

// Session state: use useRouteContext({ from: '__root__' }).session in components.
// Do not re-export useSession — it bypasses route context and causes hydration bugs.
export const authClient = {
	magicLink: {
		verify: withNetworkErrorHandling(
			betterAuthClient.magicLink,
			'verify',
			'Invalid or expired token'
		),
	},

	signIn: {
		magicLink: withNetworkErrorHandling(
			betterAuthClient.signIn,
			'magicLink',
			'Failed to send sign-in link'
		),
	},

	/** Signs out and refreshes route data so UI reflects logged-out state. */
	async signOut(router: { invalidate: () => Promise<void> }) {
		const result = await withNetworkErrorHandling(
			betterAuthClient,
			'signOut',
			'Sign-out failed'
		)()
		// Invalidate unconditionally: if the server cleared the session before
		// returning an error, skipping invalidate would leave the UI stale.
		await router.invalidate()
		return result
	},
}
