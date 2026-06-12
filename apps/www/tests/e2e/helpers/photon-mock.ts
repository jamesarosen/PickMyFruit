import { test as tileBase } from './tile-mock'

/** Downtown Napa — anchor point for deterministic test suggestions. */
const MOCK_ANCHOR = { lat: 38.2975, lng: -122.2869 }

/** Spreads a query string into a deterministic lat/lng around Napa. */
function hashToLatLng(query: string): { lat: number; lng: number } {
	let hash = 0
	for (let i = 0; i < query.length; i++) {
		hash = (hash * 31 + query.charCodeAt(i)) | 0
	}
	return {
		lat: MOCK_ANCHOR.lat + ((hash & 0xff) - 128) * 0.0001,
		lng: MOCK_ANCHOR.lng + (((hash >> 8) & 0xff) - 128) * 0.0001,
	}
}

type PhotonFeature = {
	type: 'Feature'
	geometry: { type: 'Point'; coordinates: [number, number] }
	properties: Record<string, string>
}

/** A fixed French result so tests can exercise the international path. */
const PARIS_FEATURE: PhotonFeature = {
	type: 'Feature',
	geometry: { type: 'Point', coordinates: [2.3312, 48.8693] },
	properties: {
		housenumber: '12',
		street: 'Rue de la Paix',
		city: 'Paris',
		postcode: '75002',
		state: 'Île-de-France',
		country: 'France',
		countrycode: 'FR',
		osm_key: 'building',
		osm_value: 'yes',
	},
}

function napaFeature(query: string): PhotonFeature {
	const { lat, lng } = hashToLatLng(query)
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [lng, lat] },
		properties: {
			housenumber: '400',
			street: 'School Street',
			city: 'Napa',
			postcode: '94559',
			state: 'California',
			country: 'United States',
			countrycode: 'US',
			osm_key: 'building',
			osm_value: 'yes',
		},
	}
}

/** A reverse-geocode result clearly distinguishable from search results. */
function reverseFeature(lat: number, lng: number): PhotonFeature {
	return {
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [lng, lat] },
		properties: {
			housenumber: '1600',
			street: 'Reverse Road',
			city: 'Sonoma',
			postcode: '95476',
			state: 'California',
			country: 'United States',
			countrycode: 'US',
			osm_key: 'building',
			osm_value: 'yes',
		},
	}
}

export type PhotonMockFixture = {
	/** Number of intercepted Photon search requests served by the mock. */
	callCount: number
	/** The most recent `q` parameter the mock saw. */
	lastQuery: string | null
	/**
	 * Coordinates served for a given query, for assertions. Keyed by query
	 * (not "last served") so overlapping in-flight requests cannot race the
	 * assertion.
	 */
	resultFor: (query: string) => { lat: number; lng: number } | undefined
	/**
	 * The `lat`/`lon` location-bias parameters a search request carried, or
	 * null when it carried none. Keyed by query for the same race-free reason
	 * as `resultFor`.
	 */
	biasFor: (query: string) => { lat: number; lng: number } | null | undefined
	/** Number of intercepted Photon reverse-geocode requests. */
	reverseCallCount: number
	/** The `lat`/`lon` of the most recent reverse-geocode request. */
	lastReverse: { lat: number; lng: number } | null
}

/** Reads the `lat`/`lon` pair from a Photon URL, or null when absent. */
function readLatLng(url: URL): { lat: number; lng: number } | null {
	const lat = url.searchParams.get('lat')
	const lng = url.searchParams.get('lon')
	if (lat === null || lng === null) return null
	return { lat: Number(lat), lng: Number(lng) }
}

/**
 * Fixture that intercepts all Photon (address autosuggest) requests at the
 * network boundary. Search queries containing "paris" get a French address,
 * "nowhere" gets an empty result set, and anything else gets a deterministic
 * Napa address. Reverse-geocode requests echo the requested coordinates back
 * as "1600 Reverse Road, Sonoma".
 */
export const test = tileBase.extend<{ photonMock: PhotonMockFixture }>({
	photonMock: [
		async ({ context }, use) => {
			const servedResults = new Map<string, { lat: number; lng: number }>()
			const servedBiases = new Map<string, { lat: number; lng: number } | null>()
			const fixture: PhotonMockFixture = {
				callCount: 0,
				lastQuery: null,
				resultFor: (query) => servedResults.get(query),
				biasFor: (query) => servedBiases.get(query),
				reverseCallCount: 0,
				lastReverse: null,
			}

			await context.route('**/photon.komoot.io/**', async (route) => {
				const url = new URL(route.request().url())

				if (url.pathname.startsWith('/reverse')) {
					fixture.reverseCallCount++
					const position = readLatLng(url)
					fixture.lastReverse = position
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify({
							type: 'FeatureCollection',
							features: position ? [reverseFeature(position.lat, position.lng)] : [],
						}),
					})
					return
				}

				const q = url.searchParams.get('q') ?? ''

				fixture.callCount++
				fixture.lastQuery = q
				servedBiases.set(q, readLatLng(url))

				let features: PhotonFeature[]
				if (/nowhere/i.test(q)) {
					features = []
				} else if (/paris/i.test(q)) {
					features = [PARIS_FEATURE]
				} else {
					features = [napaFeature(q)]
				}

				if (features.length > 0) {
					const [lng, lat] = features[0].geometry.coordinates
					servedResults.set(q, { lat, lng })
				}

				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ type: 'FeatureCollection', features }),
				})
			})

			await use(fixture)
		},
		{ auto: true },
	],
})

export { expect } from '@playwright/test'
