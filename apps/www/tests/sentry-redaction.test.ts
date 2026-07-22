import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/env', () => ({
	clientEnv: {
		sentryDsn: undefined,
		sentryEnabled: false,
		sentryEnvironment: 'test',
		sentryRelease: undefined,
		sentrySampleRate: 0,
		sentryTracesSampleRate: 0,
		mode: 'test',
	},
}))

const {
	redactGeoServiceUrl,
	redactGeoBreadcrumb,
	redactGeoSpan,
	IGNORED_ERROR_PATTERNS,
} = await import('../src/lib/sentry')

/** Mirrors how Sentry's `ignoreErrors` matches an event: any pattern hits. */
function isIgnored(message: string): boolean {
	return IGNORED_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

describe('IGNORED_ERROR_PATTERNS', () => {
	it.each([
		"TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers')",
		"TypeError: undefined is not an object (evaluating 'window.webkit.messageHandlers[e].postMessage')",
	])('ignores Meta in-app browser bridge error: %s', (message) => {
		expect(isIgnored(message)).toBe(true)
	})

	it.each([
		'TypeError: Cannot read properties of undefined (reading id)',
		"ReferenceError: Can't find variable: fetch",
		'Error: Failed to load listing',
	])('does not ignore genuine application error: %s', (message) => {
		expect(isIgnored(message)).toBe(false)
	})
})

describe('redactGeoServiceUrl', () => {
	it.each([
		{
			label: 'Photon search query and bias coordinates',
			url: 'https://photon.komoot.io/api/?q=400%20school&lat=38.29&lon=-122.45',
			expected: 'https://photon.komoot.io/api/',
		},
		{
			label: 'Photon reverse-geocode coordinates',
			url: 'https://photon.komoot.io/reverse?lat=38.29&lon=-122.45&limit=1',
			expected: 'https://photon.komoot.io/reverse',
		},
		{
			label: 'Nominatim query',
			url: 'https://nominatim.openstreetmap.org/search?q=123+Main+St&format=json',
			expected: 'https://nominatim.openstreetmap.org/search',
		},
	])('strips the query string from $label', ({ url, expected }) => {
		expect(redactGeoServiceUrl(url)).toBe(expected)
	})

	it.each([
		{
			label: 'other hosts',
			url: 'https://example.com/api?token=abc',
		},
		{
			label: 'relative URLs',
			url: '/api/listings?created=true',
		},
		{
			label: 'non-URL strings',
			url: 'not a url',
		},
	])('leaves $label untouched', ({ url }) => {
		expect(redactGeoServiceUrl(url)).toBe(url)
	})
})

describe('redactGeoBreadcrumb', () => {
	it('strips coordinates from fetch breadcrumb URLs', () => {
		const breadcrumb = {
			category: 'fetch',
			data: {
				method: 'GET',
				url: 'https://photon.komoot.io/reverse?lat=38.29&lon=-122.45',
				status_code: 200,
			},
		}

		const redacted = redactGeoBreadcrumb(breadcrumb)

		expect(redacted.data?.url).toBe('https://photon.komoot.io/reverse')
		expect(redacted.data?.method).toBe('GET')
	})

	it('leaves other breadcrumbs untouched', () => {
		const breadcrumb = {
			category: 'fetch',
			data: { method: 'POST', url: '/api/listings' },
		}

		expect(redactGeoBreadcrumb(breadcrumb).data?.url).toBe('/api/listings')
	})

	it('tolerates breadcrumbs without data', () => {
		const breadcrumb = { category: 'console', message: 'hello' }

		expect(redactGeoBreadcrumb(breadcrumb)).toBe(breadcrumb)
	})
})

describe('redactGeoSpan', () => {
	// Mirrors what @sentry/core's getFetchSpanAttributes actually sets on
	// browser fetch spans (`url`, `http.url`, `http.query`, `http.fragment`,
	// `server.address`, `type`) plus the server-side shape (`url.full`,
	// `url.query`) — not merely the keys the implementation happens to know.
	function makeSpan() {
		const fullUrl = 'https://photon.komoot.io/api/?q=secret&lat=38.29&lon=-122.45'
		return {
			span_id: 'a',
			trace_id: 'b',
			start_timestamp: 0,
			description:
				'GET https://photon.komoot.io/api/?q=secret&lat=38.29&lon=-122.45',
			data: {
				url: fullUrl,
				'http.url': fullUrl,
				'url.full': fullUrl,
				'http.query': '?q=secret&lat=38.29&lon=-122.45',
				'url.query': 'q=secret&lat=38.29&lon=-122.45',
				'http.fragment': 'frag',
				'server.address': 'photon.komoot.io',
				'http.method': 'GET',
				type: 'fetch',
			},
		}
	}

	it('strips geocoding URLs and query attributes from http spans', () => {
		const span = redactGeoSpan(makeSpan())

		expect(span.description).toBe('GET https://photon.komoot.io/api/')
		expect(span.data?.url).toBe('https://photon.komoot.io/api/')
		expect(span.data?.['http.url']).toBe('https://photon.komoot.io/api/')
		expect(span.data?.['url.full']).toBe('https://photon.komoot.io/api/')
		expect(span.data?.['http.query']).toBeUndefined()
		expect(span.data?.['url.query']).toBeUndefined()
		expect(span.data?.['http.fragment']).toBeUndefined()
		expect(span.data?.['http.method']).toBe('GET')
		expect(span.data?.['server.address']).toBe('photon.komoot.io')
	})

	it('leaves spans for other hosts untouched', () => {
		const span = {
			span_id: 'a',
			trace_id: 'b',
			start_timestamp: 0,
			description: 'GET https://example.com/api?token=abc',
			data: {
				'http.url': 'https://example.com/api?token=abc',
				'http.query': '?token=abc',
			},
		}

		const redacted = redactGeoSpan(span)

		expect(redacted.description).toBe('GET https://example.com/api?token=abc')
		expect(redacted.data?.['http.url']).toBe('https://example.com/api?token=abc')
		expect(redacted.data?.['http.query']).toBe('?token=abc')
	})

	it('tolerates spans without data or description', () => {
		// The SDK types `data` as required, but be defensive at runtime.
		const span = {
			span_id: 'a',
			trace_id: 'b',
			start_timestamp: 0,
		} as Parameters<typeof redactGeoSpan>[0]

		expect(redactGeoSpan(span)).toBe(span)
	})
})
