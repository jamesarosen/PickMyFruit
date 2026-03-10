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
})
