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
