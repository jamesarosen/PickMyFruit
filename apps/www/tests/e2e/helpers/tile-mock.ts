import { test as nominatimBase } from './nominatim-mock'

/**
 * Minimal valid MapLibre style with no sources or layers, so the map fires its
 * `load` event without fetching vector tiles, sprites, or glyphs. The app adds
 * its own GeoJSON sources and fill/line layers after load, none of which need
 * those external assets.
 */
const EMPTY_STYLE = {
	version: 8,
	sources: {},
	layers: [],
}

export type TileMockFixture = {
	/** Number of intercepted OpenFreeMap requests served by the mock. */
	callCount: number
}

/**
 * Fixture that intercepts all OpenFreeMap requests at the network boundary,
 * keeping the E2E suite deterministic by never hitting the real tile service.
 */
export const test = nominatimBase.extend<{ tileMock: TileMockFixture }>({
	tileMock: [
		async ({ context }, use) => {
			const fixture: TileMockFixture = { callCount: 0 }

			await context.route('**/tiles.openfreemap.org/**', async (route) => {
				fixture.callCount++

				const pathname = new URL(route.request().url()).pathname

				// Style requests get a minimal valid style; everything else
				// (tiles, sprites, glyphs) is served as an empty body so no
				// request escapes to the network.
				if (pathname.includes('/styles/')) {
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify(EMPTY_STYLE),
					})
					return
				}

				await route.fulfill({ status: 204, body: '' })
			})

			await use(fixture)
		},
		{ auto: true },
	],
})

export { expect } from '@playwright/test'
