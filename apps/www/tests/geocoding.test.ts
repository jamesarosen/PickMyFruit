import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { faker } from '@faker-js/faker'
import {
	geocodeAddress,
	GeocodingNetworkError,
	GeocodingNotFoundError,
	GeocodingResponseError,
} from '../src/lib/geocoding'
import { Sentry } from '../src/lib/sentry'

// Stub Sentry so we can verify captures without a real DSN
vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		addBreadcrumb: vi.fn(),
		startSpan: vi.fn((_, fn: () => unknown) => fn()),
		captureException: vi.fn(),
		captureMessage: vi.fn(),
	},
}))

// Stub env (pulled in transitively by sentry.ts)
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

function makeNominatimResponse(lat: number, lng: number): string {
	return JSON.stringify([{ lat: String(lat), lon: String(lng) }])
}

function mockFetch(body: string, status = 200): ReturnType<typeof vi.spyOn> {
	return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
		new Response(body, {
			status,
			headers: { 'Content-Type': 'application/json' },
		})
	)
}

beforeEach(() => {
	vi.clearAllMocks()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('geocodeAddress — happy path', () => {
	it.each([
		{ lat: 38.2975, lng: -122.2869, label: 'Napa, CA' },
		{ lat: 37.7749, lng: -122.4194, label: 'San Francisco, CA' },
		{ lat: 34.0522, lng: -118.2437, label: 'Los Angeles, CA' },
	])('returns $label coords', async ({ lat, lng }) => {
		const address = faker.location.streetAddress()
		const city = faker.location.city()
		const state = faker.location.state({ abbreviated: true })

		mockFetch(makeNominatimResponse(lat, lng))

		const result = await geocodeAddress({ address, city, state })

		expect(result.lat).toBeCloseTo(lat)
		expect(result.lng).toBeCloseTo(lng)
	})
})

describe('geocodeAddress — international queries', () => {
	it('does not restrict results to a fixed country', async () => {
		const spy = mockFetch(makeNominatimResponse(48.8693, 2.3312))

		await geocodeAddress({ address: '12 Rue de la Paix', city: 'Paris' })

		const url = new URL(spy.mock.calls[0][0] as string)
		expect(url.searchParams.get('countrycodes')).toBeNull()
	})

	it('includes the country name in the free-form query', async () => {
		const spy = mockFetch(makeNominatimResponse(-45.0302, 168.6626))

		await geocodeAddress({
			address: '1 Rural Lane',
			city: 'Smallville',
			state: 'Otago',
			zip: '9376',
			country: 'NZ',
		})

		const url = new URL(spy.mock.calls[0][0] as string)
		expect(url.searchParams.get('q')).toBe(
			'1 Rural Lane, Smallville, Otago, 9376, New Zealand'
		)
	})

	it('omits the state and zip parts when absent', async () => {
		const spy = mockFetch(makeNominatimResponse(1.29, 103.85))

		await geocodeAddress({
			address: '10 Bayfront Ave',
			city: 'Singapore',
			country: 'SG',
		})

		const url = new URL(spy.mock.calls[0][0] as string)
		expect(url.searchParams.get('q')).toBe(
			'10 Bayfront Ave, Singapore, Singapore'
		)
	})
})

describe('geocodeAddress — empty results', () => {
	it('throws GeocodingNotFoundError when Nominatim returns []', async () => {
		mockFetch('[]')

		await expect(
			geocodeAddress({
				address: faker.location.streetAddress(),
				city: faker.location.city(),
				state: faker.location.state({ abbreviated: true }),
			})
		).rejects.toThrow(GeocodingNotFoundError)
	})

	it('includes user-facing message in GeocodingNotFoundError', async () => {
		mockFetch('[]')

		await expect(
			geocodeAddress({ address: '1 Nowhere Ln', city: 'Nowhere', state: 'XX' })
		).rejects.toThrow('Address not found')
	})
})

describe('geocodeAddress — non-200 response', () => {
	it('throws GeocodingNetworkError on 500', async () => {
		mockFetch('Internal Server Error', 500)

		await expect(
			geocodeAddress({
				address: faker.location.streetAddress(),
				city: faker.location.city(),
				state: faker.location.state({ abbreviated: true }),
			})
		).rejects.toThrow(GeocodingNetworkError)
	})

	it('throws GeocodingNetworkError on 404', async () => {
		mockFetch('Not Found', 404)

		await expect(
			geocodeAddress({
				address: faker.location.streetAddress(),
				city: faker.location.city(),
				state: faker.location.state({ abbreviated: true }),
			})
		).rejects.toThrow(GeocodingNetworkError)
	})

	it('on 429, captures geocoding.rate_limited at warning level', async () => {
		mockFetch('Too Many Requests', 429)

		await expect(
			geocodeAddress({
				address: faker.location.streetAddress(),
				city: faker.location.city(),
				state: faker.location.state({ abbreviated: true }),
			})
		).rejects.toThrow(/busy.*429/)

		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			'geocoding.rate_limited',
			expect.objectContaining({ level: 'warning' })
		)
	})

	it('on 403, captures geocoding.blocked at error level', async () => {
		mockFetch('Forbidden', 403)

		await expect(
			geocodeAddress({
				address: faker.location.streetAddress(),
				city: faker.location.city(),
				state: faker.location.state({ abbreviated: true }),
			})
		).rejects.toThrow(/rejected.*403/)

		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			'geocoding.blocked',
			expect.objectContaining({ level: 'error' })
		)
	})
})

describe('geocodeAddress — malformed response', () => {
	it('throws GeocodingResponseError when body is not valid JSON', async () => {
		mockFetch('not json at all }{', 200)

		await expect(
			geocodeAddress({
				address: faker.location.streetAddress(),
				city: faker.location.city(),
				state: faker.location.state({ abbreviated: true }),
			})
		).rejects.toThrow(GeocodingResponseError)
	})

	it('throws GeocodingResponseError when JSON does not match schema', async () => {
		// Valid JSON but wrong shape — missing `display_name`
		mockFetch(JSON.stringify([{ latitude: 38.0, longitude: -122.0 }]), 200)

		await expect(
			geocodeAddress({
				address: faker.location.streetAddress(),
				city: faker.location.city(),
				state: faker.location.state({ abbreviated: true }),
			})
		).rejects.toThrow(GeocodingResponseError)
	})
})
