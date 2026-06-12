/**
 * Sliding-window rate limiting held in process memory.
 *
 * Suitable for this app's single-machine deployment (fly.toml runs one VM, so
 * counters need no cross-instance coordination). A process restart clears all
 * windows, which is acceptable for abuse throttling.
 */

export interface SlidingWindowLimiter {
	/**
	 * Records an attempt for `key` and reports whether it fits the window's
	 * budget. Denied attempts are not recorded, so a flood does not extend its
	 * own lockout.
	 */
	attempt(key: string, now?: number): boolean
}

/** Creates a limiter allowing `max` attempts per key within a trailing `windowMs`. */
export function createSlidingWindowLimiter(options: {
	windowMs: number
	max: number
	/** Key count that triggers a sweep of expired entries. Exposed for tests. */
	sweepThreshold?: number
}): SlidingWindowLimiter {
	const { windowMs, max, sweepThreshold = 10_000 } = options
	const attemptsByKey = new Map<string, number[]>()

	// Bounds memory under key churn (e.g. an attacker rotating addresses):
	// drop every key whose attempts have all left the window.
	function sweep(cutoff: number): void {
		for (const [key, times] of attemptsByKey) {
			const live = times.filter((t) => t > cutoff)
			if (live.length === 0) {
				attemptsByKey.delete(key)
			} else {
				attemptsByKey.set(key, live)
			}
		}
	}

	return {
		attempt(key, now = Date.now()) {
			const cutoff = now - windowMs
			if (attemptsByKey.size > sweepThreshold) {
				sweep(cutoff)
			}
			const live = (attemptsByKey.get(key) ?? []).filter((t) => t > cutoff)
			if (live.length >= max) {
				attemptsByKey.set(key, live)
				return false
			}
			live.push(now)
			attemptsByKey.set(key, live)
			return true
		},
	}
}
