import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { faker } from '@faker-js/faker'
import {
	GeocodingNetworkError,
	GeocodingNotFoundError,
	GeocodingResponseError,
} from '../src/lib/geocoding'

// Stub Sentry so we can verify captures without a real DSN
vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		addBreadcrumb: vi.fn(),
		startSpan: vi.fn((_, fn: () => unknown) => fn()),
		captureException: vi.fn(),
		captureMessage: vi.fn(),
	},
}))

const { Sentry } = await import('../src/lib/sentry')
const { fetchGeocode, geocodeForClient } =
	await import('../src/lib/geocoding.server')
const { verifyGeocodeToken } = await import('../src/lib/geocode-token.server')

function makeInput() {
	return {
		address: faker.location.streetAddress(),
		city: faker.location.city(),
		state: faker.location.state({ abbreviated: true }),
	}
}

function makeNominatimResponse(lat: number, lng: number): string {
	return JSON.stringify([{ lat: String(lat), lon: String(lng) }])
}

// Mints a fresh Response per call — a Response body is single-use, and some
// tests trigger several fetches against one mock.
function mockFetch(body: string, status = 200): void {
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async () =>
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

describe('fetchGeocode — happy path', () => {
	it.each([
		{ lat: 38.2975, lng: -122.2869, label: 'Napa, CA' },
		{ lat: 37.7749, lng: -122.4194, label: 'San Francisco, CA' },
		{ lat: 34.0522, lng: -118.2437, label: 'Los Angeles, CA' },
	])('returns $label coords', async ({ lat, lng }) => {
		mockFetch(makeNominatimResponse(lat, lng))

		const result = await fetchGeocode(makeInput())

		expect(result.lat).toBeCloseTo(lat)
		expect(result.lng).toBeCloseTo(lng)
	})

	it('sends an identifying User-Agent to the configured NOMINATIM_URL', async () => {
		mockFetch(makeNominatimResponse(38.0, -122.0))

		await fetchGeocode(makeInput())

		const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0] as [
			string,
			RequestInit,
		]
		expect(url).toContain('http://127.0.0.1:5175/search')
		expect(new Headers(init.headers).get('User-Agent')).toContain('PickMyFruit')
	})
})

describe('fetchGeocode — empty results', () => {
	it('throws GeocodingNotFoundError when Nominatim returns []', async () => {
		mockFetch('[]')

		await expect(fetchGeocode(makeInput())).rejects.toThrow(
			GeocodingNotFoundError
		)
	})

	it('includes user-facing message in GeocodingNotFoundError', async () => {
		mockFetch('[]')

		await expect(
			fetchGeocode({ address: '1 Nowhere Ln', city: 'Nowhere', state: 'XX' })
		).rejects.toThrow('Address not found')
	})
})

describe('fetchGeocode — non-200 response', () => {
	it.each([{ status: 500 }, { status: 404 }])(
		'throws GeocodingNetworkError on $status',
		async ({ status }) => {
			mockFetch('error body', status)

			await expect(fetchGeocode(makeInput())).rejects.toThrow(
				GeocodingNetworkError
			)
		}
	)

	it('on 429, captures geocoding.rate_limited at warning level', async () => {
		mockFetch('Too Many Requests', 429)

		await expect(fetchGeocode(makeInput())).rejects.toThrow(/busy.*429/)

		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			'geocoding.rate_limited',
			expect.objectContaining({ level: 'warning' })
		)
	})

	it('on 403, captures geocoding.blocked at error level', async () => {
		mockFetch('Forbidden', 403)

		await expect(fetchGeocode(makeInput())).rejects.toThrow(/rejected.*403/)

		expect(Sentry.captureMessage).toHaveBeenCalledWith(
			'geocoding.blocked',
			expect.objectContaining({ level: 'error' })
		)
	})
})

describe('fetchGeocode — malformed response', () => {
	it('throws GeocodingResponseError when body is not valid JSON', async () => {
		mockFetch('not json at all }{', 200)

		await expect(fetchGeocode(makeInput())).rejects.toThrow(
			GeocodingResponseError
		)
	})

	it('throws GeocodingResponseError when JSON does not match schema', async () => {
		mockFetch(JSON.stringify([{ latitude: 38.0, longitude: -122.0 }]), 200)

		await expect(fetchGeocode(makeInput())).rejects.toThrow(
			GeocodingResponseError
		)
	})
})

describe('geocodeForClient', () => {
	// The module-level limiters (per-IP and the global 1 req/s Nominatim
	// policy) share state across tests; fake timers let each test advance past
	// the policy window instead of sleeping. The clock must advance
	// monotonically across tests — resetting it would leave earlier tests'
	// limiter entries in the future, wrongly denying the next test.
	let fakeNow = Date.now()
	beforeEach(() => {
		fakeNow += 120_000
		vi.useFakeTimers({ now: fakeNow })
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	function headersFor(ip: string): Headers {
		return new Headers({ 'fly-client-ip': ip })
	}

	it('returns coordinates with a token that verifyGeocodeToken accepts', async () => {
		const input = makeInput()
		mockFetch(makeNominatimResponse(38.5, -122.4))

		const result = await geocodeForClient(input, headersFor(faker.internet.ip()))

		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.lat).toBeCloseTo(38.5)
		expect(result.lng).toBeCloseTo(-122.4)
		expect(
			verifyGeocodeToken(input, result.lat, result.lng, {
				ts: result.ts,
				sig: result.sig,
			})
		).toBe(true)
	})

	it('maps empty results to NOT_FOUND', async () => {
		mockFetch('[]')

		const result = await geocodeForClient(
			makeInput(),
			headersFor(faker.internet.ip())
		)

		expect(result).toEqual({ ok: false, code: 'NOT_FOUND' })
	})

	it('maps upstream failures to UNAVAILABLE and captures them', async () => {
		mockFetch('oops', 500)

		const result = await geocodeForClient(
			makeInput(),
			headersFor(faker.internet.ip())
		)

		expect(result).toEqual({ ok: false, code: 'UNAVAILABLE' })
		expect(Sentry.captureException).toHaveBeenCalled()
	})

	it('rate-limits a single IP after 10 requests in a minute', async () => {
		const ip = faker.internet.ip()
		mockFetch(makeNominatimResponse(38.0, -122.0))

		for (let i = 0; i < 10; i++) {
			// Sequential on purpose: each call must land after the previous one
			// steps the fake clock past the global 1 req/s policy window while
			// staying inside the 60s per-IP window.
			// eslint-disable-next-line no-await-in-loop
			const result = await geocodeForClient(makeInput(), headersFor(ip))
			expect(result.ok).toBe(true)
			vi.advanceTimersByTime(1_100)
		}

		const result = await geocodeForClient(makeInput(), headersFor(ip))
		expect(result).toEqual({ ok: false, code: 'RATE_LIMITED' })
	})

	it('enforces the global 1 req/s Nominatim policy across IPs', async () => {
		mockFetch(makeNominatimResponse(38.0, -122.0))

		const first = await geocodeForClient(
			makeInput(),
			headersFor(faker.internet.ip())
		)
		expect(first.ok).toBe(true)

		const second = await geocodeForClient(
			makeInput(),
			headersFor(faker.internet.ip())
		)
		expect(second).toEqual({ ok: false, code: 'RATE_LIMITED' })
	})
})
