import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../src/lib/env.server', () => ({
	serverEnv: {
		PHOTOS_BASE_URL: 'http://photos.test',
		INTERNAL_TOKEN: 'test-token',
	},
}))

const mockCaptureException = vi.fn()
vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		captureException: (...args: unknown[]) => mockCaptureException(...args),
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
		expect(mockFetch).toHaveBeenCalledTimes(1)
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect(url).toBe('http://photos.test/health')
		expect(init.method).toBe('GET')
	})

	it('aborts the request after 500 ms', async () => {
		mockFetch.mockReturnValueOnce(new Promise(() => {}))
		warmPhotosService()
		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect(init.signal?.aborted).toBe(false)
		await vi.advanceTimersByTimeAsync(500)
		expect(init.signal?.aborted).toBe(true)
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

	it('reports non-AbortErrors to Sentry', async () => {
		const err = new Error('connection refused')
		mockFetch.mockRejectedValueOnce(err)
		warmPhotosService()
		await vi.runAllTimersAsync()
		expect(mockCaptureException).toHaveBeenCalledTimes(1)
		expect(mockCaptureException).toHaveBeenCalledWith(err)
	})

	it('does not report AbortError to Sentry', async () => {
		const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
		mockFetch.mockRejectedValueOnce(abort)
		warmPhotosService()
		await vi.runAllTimersAsync()
		expect(mockCaptureException).not.toHaveBeenCalled()
	})
})
