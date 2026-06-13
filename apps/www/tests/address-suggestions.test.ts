import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	addressFieldsToSuggestion,
	fetchAddressSuggestions,
	fetchReverseGeocodedAddress,
	SuggestionsUnavailableError,
} from '../src/lib/address-suggestions'

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

type PhotonProperties = Record<string, string | undefined>

function makeFeature(
	properties: PhotonProperties,
	coordinates: [number, number] = [2.3312, 48.8693]
) {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates },
		properties,
	}
}

const PARIS_PROPERTIES: PhotonProperties = {
	housenumber: '12',
	street: 'Rue de la Paix',
	city: 'Paris',
	postcode: '75002',
	state: 'Île-de-France',
	country: 'France',
	countrycode: 'FR',
}

function makePhotonResponse(features: unknown[]): string {
	return JSON.stringify({ type: 'FeatureCollection', features })
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

describe('fetchAddressSuggestions — happy path', () => {
	it('maps a Photon feature to a structured suggestion', async () => {
		mockFetch(makePhotonResponse([makeFeature(PARIS_PROPERTIES)]))

		const [suggestion] = await fetchAddressSuggestions('12 rue de la paix')

		expect(suggestion).toEqual({
			label: '12 Rue de la Paix, Paris, Île-de-France, 75002, France',
			address: '12 Rue de la Paix',
			city: 'Paris',
			state: 'Île-de-France',
			postcode: '75002',
			countryCode: 'FR',
			lat: 48.8693,
			lng: 2.3312,
		})
	})

	it('sends the query with limit and lang parameters', async () => {
		const spy = mockFetch(makePhotonResponse([]))

		await fetchAddressSuggestions('400 school st')

		const url = new URL(spy.mock.calls[0][0] as string)
		expect(url.hostname).toBe('photon.komoot.io')
		expect(url.searchParams.get('q')).toBe('400 school st')
		expect(url.searchParams.get('limit')).toBe('5')
		expect(url.searchParams.get('lang')).toBe('en')
	})

	it('uppercases the country code', async () => {
		mockFetch(
			makePhotonResponse([makeFeature({ ...PARIS_PROPERTIES, countrycode: 'fr' })])
		)

		const [suggestion] = await fetchAddressSuggestions('paris')
		expect(suggestion.countryCode).toBe('FR')
	})

	it('returns an empty array when Photon has no matches', async () => {
		mockFetch(makePhotonResponse([]))

		await expect(fetchAddressSuggestions('road to nowhere')).resolves.toEqual([])
	})
})

describe('fetchAddressSuggestions — location bias', () => {
	it('sends the bias as lat/lon parameters', async () => {
		const spy = mockFetch(makePhotonResponse([]))

		await fetchAddressSuggestions('school st', {
			bias: { lat: 38.2967151, lng: -122.292037 },
		})

		const url = new URL(spy.mock.calls[0][0] as string)
		expect(url.searchParams.get('lat')).toBe('38.2967151')
		expect(url.searchParams.get('lon')).toBe('-122.292037')
	})

	it('sends no lat/lon parameters when no bias is given', async () => {
		const spy = mockFetch(makePhotonResponse([]))

		await fetchAddressSuggestions('school st')

		const url = new URL(spy.mock.calls[0][0] as string)
		expect(url.searchParams.get('lat')).toBeNull()
		expect(url.searchParams.get('lon')).toBeNull()
	})
})

describe('fetchReverseGeocodedAddress', () => {
	const SONOMA = { lat: 38.291859, lng: -122.458036 }

	it('requests the reverse endpoint with the position', async () => {
		const spy = mockFetch(makePhotonResponse([makeFeature(PARIS_PROPERTIES)]))

		await fetchReverseGeocodedAddress(SONOMA)

		const url = new URL(spy.mock.calls[0][0] as string)
		expect(url.hostname).toBe('photon.komoot.io')
		expect(url.pathname).toBe('/reverse')
		expect(url.searchParams.get('lat')).toBe('38.291859')
		expect(url.searchParams.get('lon')).toBe('-122.458036')
		expect(url.searchParams.get('limit')).toBe('1')
		expect(url.searchParams.get('lang')).toBe('en')
	})

	it('maps the feature to a suggestion', async () => {
		mockFetch(makePhotonResponse([makeFeature(PARIS_PROPERTIES)]))

		const suggestion = await fetchReverseGeocodedAddress(SONOMA)

		expect(suggestion).toEqual({
			label: '12 Rue de la Paix, Paris, Île-de-France, 75002, France',
			address: '12 Rue de la Paix',
			city: 'Paris',
			state: 'Île-de-France',
			postcode: '75002',
			countryCode: 'FR',
			lat: 48.8693,
			lng: 2.3312,
		})
	})

	it('resolves null when Photon has no result', async () => {
		mockFetch(makePhotonResponse([]))

		await expect(fetchReverseGeocodedAddress(SONOMA)).resolves.toBeNull()
	})

	it('resolves null when the feature is unusable for a listing', async () => {
		// No street line or name — cannot prepopulate an address from it.
		mockFetch(
			makePhotonResponse([
				makeFeature({ city: 'Paris', country: 'France', countrycode: 'FR' }),
			])
		)

		await expect(fetchReverseGeocodedAddress(SONOMA)).resolves.toBeNull()
	})

	it('throws SuggestionsUnavailableError on non-2xx responses', async () => {
		mockFetch('Bad Gateway', 502)

		await expect(fetchReverseGeocodedAddress(SONOMA)).rejects.toThrow(
			SuggestionsUnavailableError
		)
	})

	it('throws SuggestionsUnavailableError on fetch rejection', async () => {
		vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))

		await expect(fetchReverseGeocodedAddress(SONOMA)).rejects.toThrow(
			SuggestionsUnavailableError
		)
	})

	it('throws SuggestionsUnavailableError when the shape is unexpected', async () => {
		mockFetch(JSON.stringify({ results: [] }))

		await expect(fetchReverseGeocodedAddress(SONOMA)).rejects.toThrow(
			SuggestionsUnavailableError
		)
	})

	it('lets aborts propagate untouched', async () => {
		const abortError = new DOMException('Aborted', 'AbortError')
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError)

		await expect(
			fetchReverseGeocodedAddress(SONOMA, {
				signal: new AbortController().signal,
			})
		).rejects.toBe(abortError)
	})
})

describe('fetchAddressSuggestions — street line composition', () => {
	it.each([
		{
			label: 'housenumber + street',
			properties: { housenumber: '12', street: 'Rue de la Paix' },
			expected: '12 Rue de la Paix',
		},
		{
			label: 'street only',
			properties: { street: 'Rue de la Paix' },
			expected: 'Rue de la Paix',
		},
		{
			label: 'name only (place-level result)',
			properties: { name: 'Napa' },
			expected: 'Napa',
		},
	])('uses $label', async ({ properties, expected }) => {
		mockFetch(
			makePhotonResponse([
				makeFeature({
					...properties,
					city: 'Somewhere',
					country: 'France',
					countrycode: 'FR',
				}),
			])
		)

		const [suggestion] = await fetchAddressSuggestions('query')
		expect(suggestion.address).toBe(expected)
	})
})

describe('fetchAddressSuggestions — locality fallback chain', () => {
	it.each([
		{
			label: 'city',
			properties: { city: 'Paris', district: 'D', county: 'C', state: 'S' },
			expected: 'Paris',
		},
		{
			label: 'district when city is missing',
			properties: { district: 'Le Marais', county: 'C', state: 'S' },
			expected: 'Le Marais',
		},
		{
			label: 'county when city and district are missing',
			properties: { county: 'Napa County', state: 'California' },
			expected: 'Napa County',
		},
		{
			label: 'state when no finer locality exists',
			properties: { state: 'California' },
			expected: 'California',
		},
		{
			label: 'country as the last resort',
			properties: {},
			expected: 'France',
		},
	])('falls back to $label', async ({ properties, expected }) => {
		mockFetch(
			makePhotonResponse([
				makeFeature({
					street: 'Main Street',
					country: 'France',
					countrycode: 'FR',
					...properties,
				}),
			])
		)

		const [suggestion] = await fetchAddressSuggestions('query')
		expect(suggestion.city).toBe(expected)
	})
})

describe('fetchAddressSuggestions — label composition', () => {
	it('omits duplicate parts (place-level results)', async () => {
		mockFetch(
			makePhotonResponse([
				makeFeature({
					name: 'Napa',
					city: 'Napa',
					state: 'California',
					country: 'United States',
					countrycode: 'US',
				}),
			])
		)

		const [suggestion] = await fetchAddressSuggestions('napa')
		expect(suggestion.label).toBe('Napa, California, United States')
	})
})

describe('fetchAddressSuggestions — unusable features', () => {
	it('skips features without a country code', async () => {
		mockFetch(
			makePhotonResponse([
				makeFeature({ street: 'Main Street', city: 'Somewhere' }),
				makeFeature(PARIS_PROPERTIES),
			])
		)

		const suggestions = await fetchAddressSuggestions('main')
		expect(suggestions).toHaveLength(1)
		expect(suggestions[0].city).toBe('Paris')
	})

	it('skips features without any street line or name', async () => {
		mockFetch(
			makePhotonResponse([
				makeFeature({ city: 'Paris', country: 'France', countrycode: 'FR' }),
				makeFeature(PARIS_PROPERTIES),
			])
		)

		const suggestions = await fetchAddressSuggestions('paris')
		expect(suggestions).toHaveLength(1)
		expect(suggestions[0].address).toBe('12 Rue de la Paix')
	})
})

describe('addressFieldsToSuggestion', () => {
	it('rebuilds a suggestion from stored listing fields', () => {
		const suggestion = addressFieldsToSuggestion({
			address: '456 Oak Avenue',
			city: 'St. Helena',
			state: 'CA',
			zip: '94574',
			country: 'US',
			lat: 38.5,
			lng: -122.47,
		})

		expect(suggestion).toEqual({
			label: '456 Oak Avenue, St. Helena, CA, 94574, United States',
			address: '456 Oak Avenue',
			city: 'St. Helena',
			state: 'CA',
			postcode: '94574',
			countryCode: 'US',
			lat: 38.5,
			lng: -122.47,
		})
	})

	it('omits missing region and postal code from the label', () => {
		const suggestion = addressFieldsToSuggestion({
			address: '12 Rue de la Paix',
			city: 'Paris',
			state: null,
			zip: null,
			country: 'FR',
			lat: 48.8693,
			lng: 2.3312,
		})

		expect(suggestion.label).toBe('12 Rue de la Paix, Paris, France')
	})
})

describe('fetchAddressSuggestions — failures', () => {
	it('throws SuggestionsUnavailableError on non-2xx responses', async () => {
		mockFetch('Bad Gateway', 502)

		await expect(fetchAddressSuggestions('paris')).rejects.toThrow(
			SuggestionsUnavailableError
		)
	})

	it('throws SuggestionsUnavailableError on fetch rejection', async () => {
		vi
			.spyOn(globalThis, 'fetch')
			.mockRejectedValueOnce(new TypeError('Failed to fetch'))

		await expect(fetchAddressSuggestions('paris')).rejects.toThrow(
			SuggestionsUnavailableError
		)
	})

	it('throws SuggestionsUnavailableError on invalid JSON', async () => {
		mockFetch('not json }{')

		await expect(fetchAddressSuggestions('paris')).rejects.toThrow(
			SuggestionsUnavailableError
		)
	})

	it('throws SuggestionsUnavailableError when the shape is unexpected', async () => {
		mockFetch(JSON.stringify({ results: [] }))

		await expect(fetchAddressSuggestions('paris')).rejects.toThrow(
			SuggestionsUnavailableError
		)
	})

	it('lets aborts propagate untouched so callers can ignore stale requests', async () => {
		const abortError = new DOMException('Aborted', 'AbortError')
		vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError)

		await expect(
			fetchAddressSuggestions('paris', { signal: new AbortController().signal })
		).rejects.toBe(abortError)
	})
})
