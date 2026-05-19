import { describe, it, expect } from 'vitest'
import { createRateLimiter } from '../src/lib/internal-rate-limit.server'

describe('createRateLimiter', () => {
	it('allows requests up to the maximum then blocks within the window', () => {
		const limiter = createRateLimiter({ windowMs: 1_000, max: 3 })
		const t0 = 1_000_000

		expect(limiter.check('1.1.1.1', t0).allowed).toBe(true)
		expect(limiter.check('1.1.1.1', t0 + 100).allowed).toBe(true)
		expect(limiter.check('1.1.1.1', t0 + 200).allowed).toBe(true)

		const blocked = limiter.check('1.1.1.1', t0 + 300)
		expect(blocked.allowed).toBe(false)
		expect(blocked.retryAfterMs).toBeGreaterThan(0)
	})

	it('resets the counter after the window elapses', () => {
		const limiter = createRateLimiter({ windowMs: 1_000, max: 2 })
		const t0 = 1_000_000

		limiter.check('1.1.1.1', t0)
		limiter.check('1.1.1.1', t0 + 100)
		expect(limiter.check('1.1.1.1', t0 + 200).allowed).toBe(false)

		expect(limiter.check('1.1.1.1', t0 + 1_500).allowed).toBe(true)
	})

	it('tracks each IP independently', () => {
		const limiter = createRateLimiter({ windowMs: 1_000, max: 1 })
		const t0 = 1_000_000

		expect(limiter.check('1.1.1.1', t0).allowed).toBe(true)
		expect(limiter.check('1.1.1.1', t0 + 1).allowed).toBe(false)

		expect(limiter.check('2.2.2.2', t0).allowed).toBe(true)
	})
})
