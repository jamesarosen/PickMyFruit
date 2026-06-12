import { test as base } from '@playwright/test'

/** Base URL of the local mock served by nominatim-mock-server.mjs (see playwright.config.ts). */
export const NOMINATIM_MOCK_URL = 'http://127.0.0.1:5175'

export type NominatimMockFixture = {
	/** Geocode requests served by the mock server since this test began. */
	callCount(): Promise<number>
}

/**
 * Geocoding runs server-side (src/lib/geocoding.server.ts) against the local
 * mock server, so this fixture's job is bookkeeping (per-test request counts)
 * plus a tripwire: the browser must never talk to Nominatim directly, so any
 * such request is aborted and fails its test loudly.
 */
export const test = base.extend<{ nominatimMock: NominatimMockFixture }>({
	nominatimMock: [
		async ({ context, request }, use) => {
			await context.route('**/nominatim.openstreetmap.org/**', (route) =>
				route.abort()
			)

			await request.post(`${NOMINATIM_MOCK_URL}/__reset`)

			await use({
				async callCount() {
					const res = await request.get(`${NOMINATIM_MOCK_URL}/__stats`)
					const stats = (await res.json()) as { count: number }
					return stats.count
				},
			})
		},
		{ auto: true },
	],
})

export { expect } from '@playwright/test'
