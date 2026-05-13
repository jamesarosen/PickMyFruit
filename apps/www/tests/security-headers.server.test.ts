import { describe, it, expect } from 'vitest'
import parseContentSecurityPolicy from 'content-security-policy-parser'
import { applySecurityHeaders } from '../src/middleware/security-headers'

describe('applySecurityHeaders', () => {
	it('sets a valid Content-Security-Policy header', () => {
		const headers = new Headers()
		applySecurityHeaders(headers)

		const csp = headers.get('Content-Security-Policy')
		expect(csp).toBeTruthy()

		const directives = parseContentSecurityPolicy(csp!)
		expect(directives.size).toBeGreaterThan(0)
	})

	it('includes frame-ancestors none to block clickjacking', () => {
		const headers = new Headers()
		applySecurityHeaders(headers)

		const csp = headers.get('Content-Security-Policy')!
		const directives = parseContentSecurityPolicy(csp)

		expect(directives.get('frame-ancestors')).toEqual(["'none'"])
	})

	it('does not include any Tigris wildcard when no image hosts are passed', () => {
		const headers = new Headers()
		applySecurityHeaders(headers, [])

		const csp = headers.get('Content-Security-Policy')!
		expect(csp).not.toContain('fly.storage.tigris.dev')
	})

	it('allows images only from the specific Tigris bucket, not all tenants', () => {
		const headers = new Headers()
		applySecurityHeaders(headers, ['https://test-bucket.fly.storage.tigris.dev'])
		const csp = headers.get('Content-Security-Policy')!

		expect(csp).toContain('https://test-bucket.fly.storage.tigris.dev')
		expect(csp).not.toContain('https://*.fly.storage.tigris.dev')
	})

	it('uses only the passed mediaOrigin in img-src, not the default bucket host', () => {
		const headers = new Headers()
		applySecurityHeaders(headers, ['https://media.pickmyfruit.com'])
		const csp = headers.get('Content-Security-Policy')!

		expect(csp).toContain('https://media.pickmyfruit.com')
		expect(csp).not.toContain('https://test-bucket.fly.storage.tigris.dev')
	})
})
