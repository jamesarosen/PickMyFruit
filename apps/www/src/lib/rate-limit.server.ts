/**
 * In-memory token-bucket rate limiter.
 *
 * Deliberately process-local: there is no shared store, so on a multi-instance
 * deployment each instance limits independently. That is acceptable for the
 * abuse cases this guards (a single client scraping or probing an endpoint),
 * and avoids standing up infrastructure. Buckets refill continuously and a
 * size cap evicts the least-recently-used keys so the map cannot grow without
 * bound.
 */

interface Bucket {
	tokens: number
	updatedAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_KEYS = 10_000

export interface RateLimitOptions {
	/** Maximum burst size (and the steady-state ceiling). */
	capacity: number
	/** Sustained refill rate in tokens per second. */
	refillPerSec: number
}

/**
 * Consumes one token for `key`. Returns `true` when the request is allowed and
 * `false` when the bucket is empty (rate limited).
 */
export function rateLimit(key: string, opts: RateLimitOptions): boolean {
	const now = Date.now()
	const existing = buckets.get(key)
	const bucket: Bucket = existing ?? { tokens: opts.capacity, updatedAt: now }

	const elapsedSec = (now - bucket.updatedAt) / 1000
	bucket.tokens = Math.min(
		opts.capacity,
		bucket.tokens + elapsedSec * opts.refillPerSec
	)
	bucket.updatedAt = now

	const allowed = bucket.tokens >= 1
	if (allowed) bucket.tokens -= 1

	// Re-insert so this key becomes most-recently-used for LRU eviction.
	buckets.delete(key)
	buckets.set(key, bucket)
	if (buckets.size > MAX_KEYS) {
		const oldest = buckets.keys().next().value
		if (oldest !== undefined) buckets.delete(oldest)
	}

	return allowed
}

/** Clears all buckets. Test-only. */
export function __resetRateLimits(): void {
	buckets.clear()
}
