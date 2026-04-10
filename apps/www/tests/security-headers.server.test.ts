import { describe, it, expect, vi } from 'vitest'
import parseContentSecurityPolicy from 'content-security-policy-parser'
import { applySecurityHeaders } from '../src/middleware/security-headers'

describe('applySecurityHeaders', () => {
	it('sets a valid Content-Security-Policy header', async () => {
		const headers = new Headers()
		await applySecurityHeaders(headers)

		const csp = headers.get('Content-Security-Policy')
		expect(csp).toBeTruthy()

		const directives = parseContentSecurityPolicy(csp!)
		expect(directives.size).toBeGreaterThan(0)
	})

	it('includes frame-ancestors none to block clickjacking', async () => {
		const headers = new Headers()
		await applySecurityHeaders(headers)

		const csp = headers.get('Content-Security-Policy')!
		const directives = parseContentSecurityPolicy(csp)

		expect(directives.get('frame-ancestors')).toEqual(["'none'"])
	})

	it('does not include any Tigris wildcard in local storage mode', async () => {
		// Test env uses STORAGE_PROVIDER=local — no bucket URL should appear.
		const headers = new Headers()
		await applySecurityHeaders(headers)

		const csp = headers.get('Content-Security-Policy')!
		expect(csp).not.toContain('fly.storage.tigris.dev')
	})

	it('allows images only from the specific Tigris bucket, not all tenants', async () => {
		vi.resetModules()
		vi.doMock('../src/lib/env.server', () => ({
			serverEnv: {
				storage: { PROVIDER: 'tigris', BUCKET_NAME: 'test-bucket' },
			},
		}))
		const { applySecurityHeaders: apply } =
			await import('../src/middleware/security-headers')

		const headers = new Headers()
		await apply(headers)
		const csp = headers.get('Content-Security-Policy')!

		expect(csp).toContain('https://test-bucket.fly.storage.tigris.dev')
		expect(csp).not.toContain('https://*.fly.storage.tigris.dev')

		vi.doUnmock('../src/lib/env.server')
		vi.resetModules()
	})
})
