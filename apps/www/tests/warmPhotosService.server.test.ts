import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/lib/env.server', () => ({
	serverEnv: {
		PHOTOS_BASE_URL: 'http://photos.test',
		INTERNAL_TOKEN: 'test-token',
	},
}))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Must follow the mocks so env is resolved at import time.
const { warmPhotosService } =
	await import('../src/lib/warmPhotosService.server')

describe('warmPhotosService', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it('sends GET /health to PHOTOS_BASE_URL', async () => {
		mockFetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
		warmPhotosService()
		await vi.runAllTimersAsync()
		expect(mockFetch).toHaveBeenCalledOnce()
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('http://photos.test/health')
		expect(init.method).toBe('GET')
	})

	it('passes a 500 ms AbortSignal', async () => {
		mockFetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
		warmPhotosService()
		await vi.runAllTimersAsync()
		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect(init.signal).toBeInstanceOf(AbortSignal)
	})

	it('does not throw when fetch rejects', async () => {
		mockFetch.mockRejectedValueOnce(new Error('connection refused'))
		await expect(
			(async () => {
				warmPhotosService()
				await vi.runAllTimersAsync()
			})()
		).resolves.toBeUndefined()
	})

	it('does not throw when the service returns a non-200 response', async () => {
		mockFetch.mockResolvedValueOnce(new Response('', { status: 503 }))
		await expect(
			(async () => {
				warmPhotosService()
				await vi.runAllTimersAsync()
			})()
		).resolves.toBeUndefined()
	})

	it('does not send x-internal-token (health is a public endpoint)', async () => {
		mockFetch.mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }))
		warmPhotosService()
		await vi.runAllTimersAsync()
		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		const headers = init.headers as Record<string, string> | undefined
		expect(headers?.['x-internal-token']).toBeUndefined()
	})
})
