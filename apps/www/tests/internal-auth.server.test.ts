import { describe, it, expect } from 'vitest'
import {
	constantTimeEquals,
	verifyInternalAuth,
	INTERNAL_AUTH_HEADER,
} from '../src/lib/internal-auth.server'

describe('constantTimeEquals', () => {
	it('returns true for identical strings', () => {
		expect(constantTimeEquals('secret-12345', 'secret-12345')).toBe(true)
	})

	it('returns false for different same-length strings', () => {
		expect(constantTimeEquals('secret-12345', 'secret-09876')).toBe(false)
	})

	it('returns false when lengths differ even if a prefix matches', () => {
		expect(constantTimeEquals('secret', 'secret-suffix')).toBe(false)
	})

	it('returns false when the expected secret is empty (env not configured)', () => {
		expect(constantTimeEquals('whatever', '')).toBe(false)
	})

	it('handles strings longer than the internal pad buffer', () => {
		const long = 'x'.repeat(128)
		expect(constantTimeEquals(long, long)).toBe(true)
		expect(constantTimeEquals(long, long.slice(0, -1) + 'y')).toBe(false)
	})
})

describe('verifyInternalAuth', () => {
	const config = {
		current: 'current-secret-min-32-chars-aaaaaaa',
		previous: 'previous-secret-min-32-chars-bbbbbbb',
	}

	it('accepts the current secret', () => {
		expect(verifyInternalAuth(config.current, config)).toBe(true)
	})

	it('accepts the previous secret during rotation', () => {
		expect(verifyInternalAuth(config.previous, config)).toBe(true)
	})

	it('rejects an unknown secret', () => {
		expect(verifyInternalAuth('nope', config)).toBe(false)
	})

	it('rejects a missing header', () => {
		expect(verifyInternalAuth(null, config)).toBe(false)
		expect(verifyInternalAuth(undefined, config)).toBe(false)
		expect(verifyInternalAuth('', config)).toBe(false)
	})

	it('rejects every value when no current secret is configured', () => {
		expect(verifyInternalAuth('anything', { current: null })).toBe(false)
		expect(verifyInternalAuth('anything', { current: undefined })).toBe(false)
		expect(verifyInternalAuth('', { current: '' })).toBe(false)
	})

	it('ignores an empty previous secret', () => {
		expect(
			verifyInternalAuth('', { current: config.current, previous: '' })
		).toBe(false)
	})
})

describe('INTERNAL_AUTH_HEADER', () => {
	it('is x-internal-auth, distinct from Authorization', () => {
		// Reserve Authorization: Bearer … for future public API keys.
		expect(INTERNAL_AUTH_HEADER).toBe('x-internal-auth')
	})
})
