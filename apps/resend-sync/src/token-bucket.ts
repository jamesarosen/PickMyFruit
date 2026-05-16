/**
 * Token bucket sized in **Resend API calls**, not upserts.
 *
 * Each upsert costs two API calls (GET → POST|PATCH). Callers `take(2)` per
 * upsert so the math survives if Resend ever ships a single-call upsert.
 *
 * `take()` blocks (via `wait`) until enough tokens accumulate. A `Retry-After`
 * directive from the server **overrides** the bucket state — we sleep at least
 * that long before the next call regardless of what the bucket says, then
 * re-fill the bucket fresh.
 */

export interface TokenBucketConfig {
	/** Tokens added per second when below capacity. */
	ratePerSec: number;
	/** Maximum token balance (sustained burst). */
	capacity: number;
	/** Injected for tests; defaults to `Date.now`. */
	now?: () => number;
	/** Injected for tests; defaults to setTimeout-based promise. */
	wait?: (ms: number) => Promise<void>;
}

export interface TokenBucket {
	/** Reserves `count` tokens, waiting if necessary. */
	take(count: number): Promise<void>;
	/**
	 * Honors a server-side `Retry-After` directive (in milliseconds).
	 * Waits at least that long and forces the bucket to empty so subsequent
	 * `take()` calls re-pay the wait cost. Use for `429` and `503` responses.
	 */
	honorRetryAfter(retryAfterMs: number): Promise<void>;
}

const defaultWait = (ms: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

export function createTokenBucket(config: TokenBucketConfig): TokenBucket {
	const now = config.now ?? Date.now;
	const wait = config.wait ?? defaultWait;

	let balance = config.capacity;
	let lastRefill = now();

	function refill(): void {
		const current = now();
		const elapsedMs = current - lastRefill;
		if (elapsedMs <= 0) return;
		const refilled = (elapsedMs / 1_000) * config.ratePerSec;
		balance = Math.min(config.capacity, balance + refilled);
		lastRefill = current;
	}

	async function take(count: number): Promise<void> {
		if (count > config.capacity) {
			throw new Error(
				`take(${count}) exceeds bucket capacity ${config.capacity}; cannot ever satisfy`,
			);
		}
		while (true) {
			refill();
			if (balance >= count) {
				balance -= count;
				return;
			}
			const deficit = count - balance;
			const waitMs = (deficit / config.ratePerSec) * 1_000;
			// eslint-disable-next-line no-await-in-loop -- intentional: refill is time-driven.
			await wait(waitMs);
		}
	}

	async function honorRetryAfter(retryAfterMs: number): Promise<void> {
		await wait(retryAfterMs);
		balance = 0;
		lastRefill = now();
	}

	return { take, honorRetryAfter };
}
