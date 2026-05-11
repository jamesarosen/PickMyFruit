/**
 * A user-safe error whose message can be shown directly to the user.
 * Used on the server to pass safe messages through server functions,
 * and on the client to mark auth-client errors as safe to display.
 */
export class UserError extends Error {
	public readonly code: string
	public readonly status?: number

	constructor(code: string, message: string, status?: number) {
		super(message)
		this.name = 'UserError'
		this.code = code
		this.status = status
	}
}

/**
 * Thrown to trigger TanStack Router / Start not-found handling; matches the
 * object shape produced by `notFound()` (`isNotFound` in `@tanstack/router-core`
 * is true when `value.isNotFound === true`).
 *
 * @see https://tanstack.com/router/latest/docs/framework/react/api/router/notFoundFunction
 */
export class NotFoundError extends Error {
	public readonly isNotFound = true as const

	constructor(message = 'Not found') {
		super(message)
		this.name = 'NotFoundError'
	}
}

/**
 * Whether `value` is a TanStack Router / Start not-found throw (including
 * {@link NotFoundError}); matches `@tanstack/router-core`’s `isNotFound`, which
 * is true when `value?.isNotFound === true`.
 *
 * @see https://tanstack.com/router/latest/docs/framework/react/api/router/notFoundFunction
 */
export function isNotFoundError(value: unknown): boolean {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { isNotFound?: unknown }).isNotFound === true
	)
}
