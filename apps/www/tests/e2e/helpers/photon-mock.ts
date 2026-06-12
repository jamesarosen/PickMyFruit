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

export type PhotonMockFixture = {
	/** Number of intercepted Photon requests served by the mock. */
	callCount: number
	/** The most recent `q` parameter the mock saw. */
	lastQuery: string | null
}

/**
 * Fixture that intercepts all Photon (address autosuggest) requests at the
 * network boundary. Queries containing "paris" get a French address,
 * "nowhere" gets an empty result set, and anything else gets a deterministic
 * Napa address.
 */
export const test = tileBase.extend<{ photonMock: PhotonMockFixture }>({
	photonMock: [
		async ({ context }, use) => {
			const fixture: PhotonMockFixture = { callCount: 0, lastQuery: null }

			await context.route('**/photon.komoot.io/**', async (route) => {
				const url = new URL(route.request().url())
				const q = url.searchParams.get('q') ?? ''

				fixture.callCount++
				fixture.lastQuery = q

				let features: PhotonFeature[]
				if (/nowhere/i.test(q)) {
					features = []
				} else if (/paris/i.test(q)) {
					features = [PARIS_FEATURE]
				} else {
					features = [napaFeature(q)]
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
