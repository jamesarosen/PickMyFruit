/**
 * Unit tests for the photos service HTTP client.
 *
 * Verifies correct headers, URL construction, response parsing, and error
 * handling without a real network connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { PhotoServiceError as PhotoServiceErrorType } from '../src/lib/photoServiceClient.server'

// ============================================================================
// Mock env — controls PHOTOS_BASE_URL and INTERNAL_TOKEN
// ============================================================================

vi.mock('../src/lib/env.server', () => ({
	serverEnv: {
		PHOTOS_BASE_URL: 'http://photos.test',
		INTERNAL_TOKEN: 'test-token',
	},
}))

// ============================================================================
// Mock global fetch
// ============================================================================

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Import SUT after mocks
const { transformPhoto, headPhoto, PhotoServiceError } =
	await import('../src/lib/photoServiceClient.server')

// ============================================================================
// transformPhoto
// ============================================================================

describe('transformPhoto', () => {
	const PHOTO_ID = '01950f9e-a96e-7b2a-a35d-4d3b4c5d6e7f'
	const CONTENT_TYPE = 'image/jpeg'
	const CONTENT_LENGTH = 1024
	const SUCCESS_BODY: import('../src/lib/photoServiceClient.server').TransformResult =
		{
			key: `pub/${PHOTO_ID}.jpg`,
			width: 800,
			height: 600,
			bytes: 102400,
			etag: '"abc123"',
			cached: false,
			coldStart: false,
			bootMs: 0,
		}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('sends POST to /transform/:photoID with correct URL', async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify(SUCCESS_BODY), { status: 200 })
		)
		await transformPhoto(PHOTO_ID, new Blob(['x']), CONTENT_TYPE, CONTENT_LENGTH)
		const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect(url).toBe(`http://photos.test/transform/${PHOTO_ID}`)
	})

	it('sends x-internal-token header', async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify(SUCCESS_BODY), { status: 200 })
		)
		await transformPhoto(PHOTO_ID, new Blob(['x']), CONTENT_TYPE, CONTENT_LENGTH)
		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect((init.headers as Record<string, string>)['x-internal-token']).toBe(
			'test-token'
		)
	})

	it('sends Content-Type header', async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify(SUCCESS_BODY), { status: 200 })
		)
		await transformPhoto(PHOTO_ID, new Blob(['x']), CONTENT_TYPE, CONTENT_LENGTH)
		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect((init.headers as Record<string, string>)['Content-Type']).toBe(
			CONTENT_TYPE
		)
	})

	it('forwards traceparent header when provided', async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify(SUCCESS_BODY), { status: 200 })
		)
		const traceparent = '00-abc-def-01'
		await transformPhoto(
			PHOTO_ID,
			new Blob(['x']),
			CONTENT_TYPE,
			CONTENT_LENGTH,
			{
				traceparent,
			}
		)
		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect((init.headers as Record<string, string>)['traceparent']).toBe(
			traceparent
		)
	})

	it('omits traceparent header when not provided', async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify(SUCCESS_BODY), { status: 200 })
		)
		await transformPhoto(PHOTO_ID, new Blob(['x']), CONTENT_TYPE, CONTENT_LENGTH)
		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect(Object.hasOwn(init.headers as object, 'traceparent')).toBe(false)
	})

	it('returns parsed JSON on 200', async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify(SUCCESS_BODY), { status: 200 })
		)
		const result = await transformPhoto(
			PHOTO_ID,
			new Blob(['x']),
			CONTENT_TYPE,
			CONTENT_LENGTH
		)
		expect(result).toEqual(SUCCESS_BODY)
	})

	it('throws PhotoServiceError on non-2xx response (e.g. 422)', async () => {
		mockFetch.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: 'transform_failed' }), { status: 422 })
		)
		await expect(
			transformPhoto(PHOTO_ID, new Blob(['x']), CONTENT_TYPE, CONTENT_LENGTH)
		).rejects.toBeInstanceOf(PhotoServiceError)
	})

	it('PhotoServiceError carries the HTTP status', async () => {
		mockFetch.mockResolvedValueOnce(new Response('bad', { status: 502 }))
		const err = await transformPhoto(
			PHOTO_ID,
			new Blob(['x']),
			CONTENT_TYPE,
			CONTENT_LENGTH
		).catch((e: unknown) => e)
		expect((err as PhotoServiceErrorType).status).toBe(502)
	})

	it('propagates AbortError when signal is aborted', async () => {
		const controller = new AbortController()
		mockFetch.mockImplementationOnce(() => {
			// Simulate the fetch rejecting with an AbortError
			const err = new DOMException('signal aborted', 'AbortError')
			return Promise.reject(err)
		})
		controller.abort()
		const err = await transformPhoto(
			PHOTO_ID,
			new Blob(['x']),
			CONTENT_TYPE,
			CONTENT_LENGTH,
			{ signal: controller.signal }
		).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(DOMException)
		expect((err as DOMException).name).toBe('AbortError')
	})
})

// ============================================================================
// headPhoto
// ============================================================================

describe('headPhoto', () => {
	const PHOTO_ID = '01950f9e-a96e-7b2a-a35d-4d3b4c5d6e7f'

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('sends HEAD to /photos/:photoID', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))
		await headPhoto(PHOTO_ID)
		const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect(url).toBe(`http://photos.test/photos/${PHOTO_ID}`)
		expect(init.method).toBe('HEAD')
	})

	it('sends x-internal-token header', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))
		await headPhoto(PHOTO_ID)
		const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
		expect((init.headers as Record<string, string>)['x-internal-token']).toBe(
			'test-token'
		)
	})

	it('returns { exists: true } on 200', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 200 }))
		await expect(headPhoto(PHOTO_ID)).resolves.toEqual({ exists: true })
	})

	it('returns { exists: false } on 404', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }))
		await expect(headPhoto(PHOTO_ID)).resolves.toEqual({ exists: false })
	})

	it('throws PhotoServiceError on unexpected status (e.g. 503)', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }))
		await expect(headPhoto(PHOTO_ID)).rejects.toBeInstanceOf(PhotoServiceError)
	})

	it('PhotoServiceError carries the HTTP status', async () => {
		mockFetch.mockResolvedValueOnce(new Response(null, { status: 502 }))
		const err = await headPhoto(PHOTO_ID).catch((e: unknown) => e)
		expect((err as PhotoServiceErrorType).status).toBe(502)
	})
})
