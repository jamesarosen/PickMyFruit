import { describe, it, expect } from "vitest";
import { createTokenBucket } from "../src/token-bucket";

/** Mockable clock + wait so tests are deterministic and instant. */
function mockClock(startMs = 0) {
	let current = startMs;
	const waits: number[] = [];
	return {
		now: () => current,
		wait: (ms: number) => {
			waits.push(ms);
			current += ms;
			return Promise.resolve();
		},
		advance(ms: number) {
			current += ms;
		},
		getWaits() {
			return waits;
		},
	};
}

describe(createTokenBucket, () => {
	it("starts full and takes without waiting", async () => {
		const clock = mockClock();
		const bucket = createTokenBucket({
			ratePerSec: 4,
			capacity: 4,
			now: clock.now,
			wait: clock.wait,
		});
		await bucket.take(2);
		await bucket.take(2);
		expect(clock.getWaits()).toStrictEqual([]);
	});

	it("waits the right amount for refill when over-budget", async () => {
		// 4 tokens/sec → 250 ms per token.
		const clock = mockClock();
		const bucket = createTokenBucket({
			ratePerSec: 4,
			capacity: 4,
			now: clock.now,
			wait: clock.wait,
		});

		// Drain the bucket.
		await bucket.take(4);
		expect(clock.getWaits()).toStrictEqual([]);

		// The next take(2) needs 2 tokens → 500 ms wait.
		await bucket.take(2);
		expect(clock.getWaits()).toStrictEqual([500]);
	});

	it("serves 2.5 upserts/sec at the doc-suggested 4 tokens/sec", async () => {
		// 10 upserts × 2 tokens = 20 tokens. Bucket starts with 4. We need 16 more,
		// which at 4 tokens/sec takes 4 s of wall time.
		const clock = mockClock();
		const bucket = createTokenBucket({
			ratePerSec: 4,
			capacity: 4,
			now: clock.now,
			wait: clock.wait,
		});

		for (let i = 0; i < 10; i++) {
			// eslint-disable-next-line no-await-in-loop
			await bucket.take(2);
		}

		const totalWaitMs = clock.getWaits().reduce((a, b) => a + b, 0);
		expect(totalWaitMs).toBeCloseTo(4_000, -1);
	});

	it("honorRetryAfter forces a wait and drains the bucket", async () => {
		const clock = mockClock();
		const bucket = createTokenBucket({
			ratePerSec: 4,
			capacity: 4,
			now: clock.now,
			wait: clock.wait,
		});

		await bucket.honorRetryAfter(2_000);
		expect(clock.getWaits()).toStrictEqual([2_000]);

		// After Retry-After, the bucket is empty regardless of elapsed time → next
		// take(2) must wait 500 ms more.
		await bucket.take(2);
		expect(clock.getWaits()).toStrictEqual([2_000, 500]);
	});

	it("throws when asked to take more than capacity (would deadlock)", async () => {
		const bucket = createTokenBucket({ ratePerSec: 4, capacity: 4 });
		await expect(bucket.take(5)).rejects.toThrow(/exceeds bucket capacity/);
	});
});
