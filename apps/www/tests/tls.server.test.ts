import { describe, it, expect } from 'vitest'
import { decideTls } from '../src/middleware/tls'

function headers(
	forwardedProto: string | null,
	forwardedHost: string | null
): { 'x-forwarded-proto': string | null; 'x-forwarded-host': string | null } {
	return {
		'x-forwarded-proto': forwardedProto,
		'x-forwarded-host': forwardedHost,
	}
}

describe('decideTls', () => {
	it('redirects plain HTTP to HTTPS when behind a TLS-terminating proxy', () => {
		const decision = decideTls(
			'http://www.pickmyfruit.com/about',
			headers('http', 'www.pickmyfruit.com'),
			false
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
			headers('https', 'pickmyfruit.com'),
			false
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
			headers('https', 'www.pickmyfruit.com'),
			false
		)
		expect(decision.redirect).toBeUndefined()
		expect(decision.addHstsHeader).toBe(true)
	})

	it('skips the HTTPS redirect when the request is verified-internal (Fly-Src)', () => {
		const decision = decideTls(
			'http://pickmyfruit.flycast/internal/v1/users/next',
			headers('http', 'pickmyfruit.flycast'),
			true
		)
		expect(decision.redirect).toBeUndefined()
		expect(decision.addHstsHeader).toBe(false)
	})

	it('suppresses HSTS on verified-internal responses even if forwarded-proto says https', () => {
		const decision = decideTls(
			'http://pickmyfruit.flycast/internal/v1/users/next',
			headers('https', 'pickmyfruit.flycast'),
			true
		)
		expect(decision.redirect).toBeUndefined()
		expect(decision.addHstsHeader).toBe(false)
	})

	it('does NOT skip the redirect when the .flycast host is unverified (forged x-forwarded-host)', () => {
		// Without a verified Fly-Src, even a .flycast-looking host must be treated
		// as public traffic — otherwise an attacker who can spoof x-forwarded-host
		// through a future proxy could disable HTTPS.
		const decision = decideTls(
			'http://pickmyfruit.flycast/internal/v1/users/next',
			headers('http', 'pickmyfruit.flycast'),
			false
		)
		expect(decision.redirect).toEqual({
			status: 307,
			location: 'https://pickmyfruit.flycast/internal/v1/users/next',
		})
	})

	it('treats local dev (no x-forwarded-proto) as non-TLS without redirecting', () => {
		const decision = decideTls(
			'http://localhost:5173/',
			headers(null, null),
			false
		)
		expect(decision.redirect).toBeUndefined()
		expect(decision.addHstsHeader).toBe(false)
	})
})
