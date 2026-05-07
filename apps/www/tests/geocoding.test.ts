import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { latLngToCell } from 'h3-js'
import { faker } from '@faker-js/faker'
import {
	geocodeAddress,
	GeocodingNetworkError,
	GeocodingNotFoundError,
	GeocodingResponseError,
} from '../src/lib/geocoding'
import { H3_RESOLUTIONS } from '../src/lib/h3-resolutions'

// Stub Sentry so we can verify captures without a real DSN
vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		addBreadcrumb: vi.fn(),
		startSpan: vi.fn((_, fn: () => unknown) => fn()),
		captureException: vi.fn(),
		captureMessage: vi.fn(),
	},
}))

// Stub env.client (pulled in transitively by sentry.ts)
vi.mock('../src/lib/env.client', () => ({
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

function makeNominatimResponse(
	lat: number,
	lng: number,
	displayName: string
): string {
	return JSON.stringify([
		{ lat: String(lat), lon: String(lng), display_name: displayName },
	])
}

function mockFetch(body: string, status = 200): void {
	vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
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
	])(
		'returns $label coords and correct h3Index',
		async ({ lat, lng, label }) => {
			const address = faker.location.streetAddress()
			const city = faker.location.city()
			const state = faker.location.state({ abbreviated: true })

			mockFetch(makeNominatimResponse(lat, lng, label))

			const result = await geocodeAddress({ address, city, state })

			expect(result.lat).toBeCloseTo(lat)
			expect(result.lng).toBeCloseTo(lng)
			expect(result.displayName).toBe(label)
			expect(result.h3Index).toBe(latLngToCell(lat, lng, H3_RESOLUTIONS.STORAGE))
		}
	)
})

describe('geocodeAddress — h3Index derivation', () => {
	it('derives h3Index from lat/lng at STORAGE resolution', async () => {
		const lat = 38.2975
		const lng = -122.2869

		mockFetch(makeNominatimResponse(lat, lng, 'Napa'))

		const result = await geocodeAddress({
			address: faker.location.streetAddress(),
			city: 'Napa',
			state: 'CA',
		})

		expect(result.h3Index).toBe(latLngToCell(lat, lng, H3_RESOLUTIONS.STORAGE))
		expect(result.h3Index).toMatch(/^8[0-9a-f]+$/)
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
