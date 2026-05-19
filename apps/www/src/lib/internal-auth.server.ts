import { timingSafeEqual } from 'node:crypto'

/**
 * Header that carries the shared-secret credential used by internal workers.
 * Distinct from `Authorization: Bearer …`, which is reserved for future public
 * API keys so the two never collide.
 */
export const INTERNAL_AUTH_HEADER = 'x-internal-auth'

/**
 * Compares two strings in constant time without leaking length. Pads both sides
 * to a fixed buffer so callers can pass strings of different lengths without
 * `timingSafeEqual` throwing.
 *
 * Returns false for empty `expected` — an unset secret must never authenticate.
 */
export function constantTimeEquals(actual: string, expected: string): boolean {
	if (expected.length === 0) return false
	const len = Math.max(actual.length, expected.length, 32)
	const a = Buffer.alloc(len, 0)
	const b = Buffer.alloc(len, 0)
	a.write(actual, 'utf8')
	b.write(expected, 'utf8')
	const equal = timingSafeEqual(a, b)
	return equal && actual.length === expected.length
}

export interface InternalAuthConfig {
	/** Current shared secret. Required (the route is 404 if the env var is unset). */
	current: string | null | undefined
	/** Previous secret accepted during rotation. Optional. */
	previous?: string | null | undefined
}

/**
 * Verifies the `x-internal-auth` header against the current secret and, if
 * supplied, the previous secret. Returns false when no current secret is
 * configured so an unconfigured environment cannot be authenticated.
 */
export function verifyInternalAuth(
	headerValue: string | null | undefined,
	config: InternalAuthConfig
): boolean {
	if (!headerValue) return false
	if (!config.current) return false
	if (constantTimeEquals(headerValue, config.current)) return true
	if (config.previous && constantTimeEquals(headerValue, config.previous)) {
		return true
	}
	return false
}
