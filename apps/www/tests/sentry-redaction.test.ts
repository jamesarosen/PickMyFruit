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

const { redactGeoServiceUrl, redactGeoBreadcrumb, redactGeoSpan } =
	await import('../src/lib/sentry')

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
	function makeSpan() {
		return {
			span_id: 'a',
			trace_id: 'b',
			start_timestamp: 0,
			description:
				'GET https://photon.komoot.io/api/?q=secret&lat=38.29&lon=-122.45',
			data: {
				'http.url': 'https://photon.komoot.io/api/?q=secret&lat=38.29&lon=-122.45',
				'url.full': 'https://photon.komoot.io/api/?q=secret&lat=38.29&lon=-122.45',
				'http.query': '?q=secret&lat=38.29&lon=-122.45',
				'http.method': 'GET',
			},
		}
	}

	it('strips geocoding URLs and query attributes from http spans', () => {
		const span = redactGeoSpan(makeSpan())

		expect(span.description).toBe('GET https://photon.komoot.io/api/')
		expect(span.data?.['http.url']).toBe('https://photon.komoot.io/api/')
		expect(span.data?.['url.full']).toBe('https://photon.komoot.io/api/')
		expect(span.data?.['http.query']).toBeUndefined()
		expect(span.data?.['http.method']).toBe('GET')
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
