import { test, expect } from './helpers/fixtures'
import type { Page } from '@playwright/test'
import {
	createTestListing,
	createTestUser,
	cleanupTestUser,
} from './helpers/test-db'

/** Sonoma Plaza — clearly west of central Napa, in a different H3 cell. */
const SONOMA = { latitude: 38.291859, longitude: -122.458036 }
/** Open ocean off the California coast — guaranteed to have no listings. */
const PACIFIC = { latitude: 36.5, longitude: -125.5 }

/**
 * Waits until the map has framed itself (data-map-center is set once the
 * maplibre chunk has compiled and initialized), so a subsequent interaction
 * isn't lost to a still-initializing map.
 */
async function waitForMapReady(page: Page): Promise<void> {
	await expect(page.locator('.listings-map')).toBeVisible({ timeout: 15_000 })
	await expect
		.poll(() => page.locator('.listings-map').getAttribute('data-map-center'), {
			timeout: 20_000,
		})
		.not.toBeNull()
}

test.describe('Home grid follows the map viewport', () => {
	test.use({ geolocation: SONOMA, permissions: ['geolocation'] })

	test('centering on a region swaps the grid to that region’s listings', async ({
		page,
	}) => {
		test.slow()
		const owner = await createTestUser()
		const napa = await createTestListing(owner.id, {
			name: 'Napa lemons',
			lat: 38.3,
			lng: -122.3,
		})
		const sonoma = await createTestListing(owner.id, {
			name: 'Sonoma figs',
			lat: SONOMA.latitude,
			lng: SONOMA.longitude,
			city: 'Sonoma',
		})

		try {
			await page.goto('/')
			await waitForMapReady(page)

			// Center on Sonoma; the map flies there and the grid re-queries the
			// viewport, leaving only the Sonoma listing in view.
			await page.getByRole('button', { name: 'Center map on my location' }).click()

			await expect(page.locator(`a[href="/listings/${sonoma.id}"]`)).toBeVisible({
				timeout: 15_000,
			})
			await expect(page.locator(`a[href="/listings/${napa.id}"]`)).toHaveCount(0)
		} finally {
			await cleanupTestUser(owner)
		}
	})

	test('the grower call-to-action is present and links to the new-listing form', async ({
		page,
		testListing,
	}) => {
		await page.goto('/')
		const cta = page.locator('a.listing-grid-cta')
		await expect(cta).toBeVisible({ timeout: 15_000 })
		await expect(cta).toHaveAttribute('href', '/listings/new')
		// It is not one of the real listing cards.
		await expect(
			page.locator(`a[href="/listings/${testListing.id}"]`)
		).toBeVisible()
	})
})

test.describe('Home grid — empty viewport falls back to nearest', () => {
	test.use({ geolocation: PACIFIC, permissions: ['geolocation'] })

	test('panning to an empty area shows the nearest-listings fallback, not a dead end', async ({
		page,
	}) => {
		test.slow()
		const owner = await createTestUser()
		const napa = await createTestListing(owner.id, {
			name: 'Napa lemons',
			lat: 38.3,
			lng: -122.3,
		})

		try {
			await page.goto('/')
			await waitForMapReady(page)

			// Center on the open ocean — nothing is in view.
			await page.getByRole('button', { name: 'Center map on my location' }).click()

			// The empty state and the nearest fallback both appear; the Napa listing
			// shows under "Nearest listings" with a Jump-to-nearest action.
			await expect(page.getByText('No listings in this view yet.')).toBeVisible({
				timeout: 15_000,
			})
			await expect(
				page.getByRole('heading', { name: 'Nearest listings' })
			).toBeVisible()
			await expect(
				page.getByRole('button', { name: /Jump to nearest/ })
			).toBeVisible()
			await expect(page.locator(`a[href="/listings/${napa.id}"]`)).toBeVisible()
		} finally {
			await cleanupTestUser(owner)
		}
	})
})

test.describe('Home grid — shareable deep link', () => {
	test('a lat/lng deep link server-renders the nearest listings', async ({
		page,
	}) => {
		const owner = await createTestUser()
		const napa = await createTestListing(owner.id, {
			name: 'Napa lemons',
			lat: 38.3,
			lng: -122.3,
		})

		try {
			// Deep link centered near the Napa listing.
			await page.goto('/?lat=38.3&lng=-122.3&z=13')
			await expect(page.locator(`a[href="/listings/${napa.id}"]`)).toBeVisible({
				timeout: 15_000,
			})
		} finally {
			await cleanupTestUser(owner)
		}
	})
})
