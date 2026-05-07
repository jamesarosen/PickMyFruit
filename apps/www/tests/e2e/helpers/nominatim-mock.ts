import { test as base } from '@playwright/test'

/** Downtown Napa — anchor point for deterministic test geocoding. */
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

export type NominatimMockFixture = {
	/** Number of intercepted Nominatim requests served by the mock. */
	callCount: number
}

/** Fixture that intercepts all Nominatim requests at the network boundary. */
export const test = base.extend<{ nominatimMock: NominatimMockFixture }>({
	nominatimMock: [
		async ({ context }, use) => {
			const fixture: NominatimMockFixture = { callCount: 0 }

			await context.route('**/nominatim.openstreetmap.org/**', (route) => {
				const url = new URL(route.request().url())
				const q = url.searchParams.get('q') ?? ''
				const { lat, lng } = hashToLatLng(q)

				fixture.callCount++

				void route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify([
						{
							lat: String(lat),
							lon: String(lng),
							display_name: q || 'Mock Location, Napa, CA, USA',
						},
					]),
				})
			})

			await use(fixture)
		},
		{ auto: true },
	],
})

export { expect } from '@playwright/test'
