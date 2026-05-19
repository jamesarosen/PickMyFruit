/**
 * Per-IP fixed-window rate limiter for `/internal/*`.
 *
 * Bounds blast radius if the shared secret ever leaks — even an authenticated
 * caller can't exfiltrate the user table at unbounded rate. In-memory only;
 * resets when the process restarts. The internal API has one expected caller
 * (the resend-sync worker), so a single-process window is enough.
 */

interface Window {
	count: number
	resetAt: number
}

export interface RateLimitConfig {
	/** Window length in milliseconds. */
	windowMs: number
	/** Maximum allowed requests per IP within the window. */
	max: number
}

export interface RateLimiter {
	check(ip: string, now?: number): { allowed: boolean; retryAfterMs: number }
}

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
	const windows = new Map<string, Window>()
	return {
		check(ip, now = Date.now()) {
			const existing = windows.get(ip)
			if (!existing || existing.resetAt <= now) {
				windows.set(ip, { count: 1, resetAt: now + config.windowMs })
				return { allowed: true, retryAfterMs: 0 }
			}
			if (existing.count >= config.max) {
				return { allowed: false, retryAfterMs: existing.resetAt - now }
			}
			existing.count += 1
			return { allowed: true, retryAfterMs: 0 }
		},
	}
}

/**
 * Process-wide rate limiter for `/internal/*`. Lazy so importing the module
 * is cheap during tests; reset between tests via the helper below.
 */
let sharedLimiter: RateLimiter | null = null

export function getInternalRateLimiter(): RateLimiter {
	sharedLimiter ??= createRateLimiter({ windowMs: 1_000, max: 30 })
	return sharedLimiter
}

export function resetInternalRateLimiterForTesting(): void {
	sharedLimiter = null
}
