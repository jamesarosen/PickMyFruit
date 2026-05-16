import { describe, it, expect } from 'vitest'
import { decideTls, isFlycastHost } from '../src/middleware/tls'

function headers(
	forwardedProto: string | null,
	forwardedHost: string | null
): { 'x-forwarded-proto': string | null; 'x-forwarded-host': string | null } {
	return {
		'x-forwarded-proto': forwardedProto,
		'x-forwarded-host': forwardedHost,
	}
}

describe('isFlycastHost', () => {
	it.each([
		['pickmyfruit.flycast', true],
		['pickmyfruit.flycast:8080', true],
		['flycast', true],
		['www.pickmyfruit.com', false],
		['pickmyfruit.com', false],
		['flycast.example.com', false],
		['', false],
		[null, false],
		[undefined, false],
	])('isFlycastHost(%j) → %s', (host, expected) => {
		expect(isFlycastHost(host)).toBe(expected)
	})
})

describe('decideTls', () => {
	it('redirects plain HTTP to HTTPS when behind a TLS-terminating proxy', () => {
		const decision = decideTls(
			'http://www.pickmyfruit.com/about',
			headers('http', 'www.pickmyfruit.com')
		)
		expect(decision.redirect).toEqual({
			status: 307,
			location: 'https://www.pickmyfruit.com/about',
		})
		expect(decision.addHstsHeader).toBe(false)
	})

	it('redirects the apex domain to www, preserving HTTPS', () => {
		const decision = decideTls(
			'https://pickmyfruit.com/listings',
			headers('https', 'pickmyfruit.com')
		)
		expect(decision.redirect).toEqual({
			status: 307,
			location: 'https://www.pickmyfruit.com/listings',
		})
		expect(decision.addHstsHeader).toBe(true)
	})

	it('passes through HTTPS requests with HSTS', () => {
		const decision = decideTls(
			'https://www.pickmyfruit.com/',
			headers('https', 'www.pickmyfruit.com')
		)
		expect(decision.redirect).toBeUndefined()
		expect(decision.addHstsHeader).toBe(true)
	})

	it('does not redirect a .flycast host even when forwarded proto is http', () => {
		const decision = decideTls(
			'http://pickmyfruit.flycast/internal/v1/users/next',
			headers('http', 'pickmyfruit.flycast')
		)
		expect(decision.redirect).toBeUndefined()
		expect(decision.addHstsHeader).toBe(false)
	})

	it('does not add HSTS on .flycast responses even if forwarded proto says https', () => {
		// Defense-in-depth: we don't expect Fly to terminate TLS for .flycast,
		// but if a misconfigured proxy ever set x-forwarded-proto=https, we still
		// suppress HSTS so a stray https://*.flycast hit can't poison clients.
		const decision = decideTls(
			'http://pickmyfruit.flycast/internal/v1/users/next',
			headers('https', 'pickmyfruit.flycast')
		)
		expect(decision.redirect).toBeUndefined()
		expect(decision.addHstsHeader).toBe(false)
	})

	it('treats local dev (no x-forwarded-proto) as non-TLS without redirecting', () => {
		const decision = decideTls('http://localhost:5173/', headers(null, null))
		expect(decision.redirect).toBeUndefined()
		expect(decision.addHstsHeader).toBe(false)
	})
})
