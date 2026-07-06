import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rateLimit, __resetRateLimits } from '../src/lib/rate-limit.server'

describe('rateLimit', () => {
	beforeEach(() => {
		__resetRateLimits()
		vi.useFakeTimers()
		vi.setSystemTime(0)
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('allows up to capacity, then blocks', () => {
		const opts = { capacity: 3, refillPerSec: 1 }
		expect(rateLimit('ip', opts)).toBe(true)
		expect(rateLimit('ip', opts)).toBe(true)
		expect(rateLimit('ip', opts)).toBe(true)
		expect(rateLimit('ip', opts)).toBe(false)
	})

	it('refills over time at the configured rate', () => {
		const opts = { capacity: 2, refillPerSec: 1 }
		expect(rateLimit('ip', opts)).toBe(true)
		expect(rateLimit('ip', opts)).toBe(true)
		expect(rateLimit('ip', opts)).toBe(false)

		// One second later, one token has refilled.
		vi.setSystemTime(1000)
		expect(rateLimit('ip', opts)).toBe(true)
		expect(rateLimit('ip', opts)).toBe(false)
	})

	it('tracks buckets independently per key', () => {
		const opts = { capacity: 1, refillPerSec: 1 }
		expect(rateLimit('a', opts)).toBe(true)
		expect(rateLimit('a', opts)).toBe(false)
		// A different client is unaffected.
		expect(rateLimit('b', opts)).toBe(true)
	})
})
