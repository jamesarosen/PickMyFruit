import { describe, it, expect, vi, afterEach } from 'vitest'

describe('rootHeadLinks', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
		vi.resetModules()
	})

	it('includes a preconnect link when VITE_MEDIA_ORIGIN is set', async () => {
		vi.stubEnv('VITE_MEDIA_ORIGIN', 'https://media.pickmyfruit.com')
		vi.stubEnv(
			'VITE_SENTRY_DSN',
			'https://1234567890abcdef@o111111111.ingest.sentry.io/222334456'
		)
		vi.resetModules()
		const { rootHeadLinks } = await import('../src/lib/root-head-links')
		const links = rootHeadLinks()
		const preconnect = links.find((l) => l.rel === 'preconnect')
		expect(preconnect?.href).toBe('https://media.pickmyfruit.com')
	})

	it('omits preconnect when VITE_MEDIA_ORIGIN is unset', async () => {
		vi.stubEnv('VITE_MEDIA_ORIGIN', '')
		vi.stubEnv(
			'VITE_SENTRY_DSN',
			'https://1234567890abcdef@o111111111.ingest.sentry.io/222334456'
		)
		vi.resetModules()
		const { rootHeadLinks } = await import('../src/lib/root-head-links')
		const links = rootHeadLinks()
		expect(links.some((l) => l.rel === 'preconnect')).toBe(false)
	})
})
