import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import { createSlidingWindowLimiter } from '../src/lib/rate-limit.server'

const WINDOW_MS = 60_000

describe('createSlidingWindowLimiter', () => {
	it('allows up to max attempts within the window', () => {
		const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, max: 3 })
		const key = faker.internet.email()
		const t0 = Date.now()

		expect(limiter.attempt(key, t0)).toBe(true)
		expect(limiter.attempt(key, t0 + 1)).toBe(true)
		expect(limiter.attempt(key, t0 + 2)).toBe(true)
		expect(limiter.attempt(key, t0 + 3)).toBe(false)
	})

	it('allows again once earlier attempts leave the window', () => {
		const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, max: 2 })
		const key = faker.internet.email()
		const t0 = Date.now()
		const mid = t0 + WINDOW_MS / 2

		expect(limiter.attempt(key, t0)).toBe(true)
		expect(limiter.attempt(key, mid)).toBe(true)
		expect(limiter.attempt(key, mid + 1)).toBe(false)

		// t0 has left the window; mid is still inside it — exactly one slot frees.
		const later = t0 + WINDOW_MS + 1
		expect(limiter.attempt(key, later)).toBe(true)
		expect(limiter.attempt(key, later + 1)).toBe(false)
	})

	it('does not let denied attempts extend the lockout', () => {
		const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, max: 1 })
		const key = faker.internet.email()
		const t0 = Date.now()

		expect(limiter.attempt(key, t0)).toBe(true)
		// Hammer while locked out — these must not count as attempts.
		for (let i = 1; i <= 10; i++) {
			expect(limiter.attempt(key, t0 + i)).toBe(false)
		}
		expect(limiter.attempt(key, t0 + WINDOW_MS + 1)).toBe(true)
	})

	it('tracks keys independently', () => {
		const limiter = createSlidingWindowLimiter({ windowMs: WINDOW_MS, max: 1 })
		const t0 = Date.now()

		expect(limiter.attempt('a@example.com', t0)).toBe(true)
		expect(limiter.attempt('a@example.com', t0 + 1)).toBe(false)
		expect(limiter.attempt('b@example.com', t0 + 1)).toBe(true)
	})

	it('sweeps expired keys without affecting live ones', () => {
		const limiter = createSlidingWindowLimiter({
			windowMs: WINDOW_MS,
			max: 1,
			sweepThreshold: 5,
		})
		const t0 = Date.now()

		for (let i = 0; i < 10; i++) {
			expect(limiter.attempt(`stale-${i}`, t0)).toBe(true)
		}
		const live = faker.internet.email()
		expect(limiter.attempt(live, t0 + WINDOW_MS - 1)).toBe(true)

		// Crossing the threshold after the stale keys expire triggers a sweep;
		// the live key's attempt must survive it.
		expect(limiter.attempt('fresh', t0 + WINDOW_MS + 1)).toBe(true)
		expect(limiter.attempt(live, t0 + WINDOW_MS + 2)).toBe(false)
		// Stale keys are usable again after expiry.
		expect(limiter.attempt('stale-0', t0 + WINDOW_MS + 3)).toBe(true)
	})
})
