import { test, expect } from './helpers/fixtures'
import type { Page } from '@playwright/test'
import {
	createTestListing,
	createTestUser,
	cleanupTestUser,
} from './helpers/test-db'

/** Sonoma Plaza — a granted position clearly west of the Napa fallback. */
const SONOMA_PLAZA = { latitude: 38.291859, longitude: -122.458036 }

/**
 * Reads the live map center the component mirrors onto `data-map-center`.
 * Returns null until the map has reported its center at least once.
 */
async function readMapCenter(
	page: Page
): Promise<{ lng: number; lat: number } | null> {
	const value = await page
		.locator('.listings-map')
		.getAttribute('data-map-center')
	if (!value) return null
	const [lng, lat] = value.split(',').map(Number)
	return { lng, lat }
}

function centerButton(page: Page) {
	return page.getByRole('button', { name: 'Center map on my location' })
}

test.describe('Home map — defaults to Napa, centering is opt-in', () => {
	test.use({ geolocation: SONOMA_PLAZA, permissions: ['geolocation'] })

	test('does not ask for or use the position on load', async ({ page }) => {
		test.slow()
		const owner = await createTestUser()
		// Default test listing sits in central Napa (38.3, -122.3).
		await createTestListing(owner.id, { name: 'Napa lemons' })

		try {
			await page.goto('/')
			await expect(page.locator('.listings-map')).toBeVisible({ timeout: 15_000 })

			// Even with permission granted, the map frames the Napa listing — the
			// page never requested the position, so it cannot have centered on it.
			await expect
				.poll(
					async () => {
						const center = await readMapCenter(page)
						return center !== null && center.lng > -122.35
					},
					{ timeout: 15_000 }
				)
				.toBe(true)

			// Give any stray async work a beat, then confirm it is still on Napa.
			await page.waitForTimeout(1_000)
			const center = await readMapCenter(page)
			expect(Math.abs(center!.lng - SONOMA_PLAZA.longitude)).toBeGreaterThan(0.1)
		} finally {
			await cleanupTestUser(owner)
		}
	})

	test('the Center button pans to the user’s position and zooms to 13', async ({
		page,
	}) => {
		test.slow()
		const owner = await createTestUser()
		await createTestListing(owner.id, { name: 'Napa lemons' })

		try {
			await page.goto('/')
			await expect(page.locator('.listings-map')).toBeVisible({ timeout: 15_000 })

			// Wait for the default Napa framing and capture its fit-to-bounds zoom.
			await expect
				.poll(
					async () => {
						const center = await readMapCenter(page)
						return center !== null && center.lng > -122.35
					},
					{ timeout: 15_000 }
				)
				.toBe(true)
			const napaZoom = Number(
				await page.locator('.listings-map').getAttribute('data-map-zoom')
			)
			// The default fit-to-bounds zoom is tighter than 13, so centering is an
			// observable zoom change.
			expect(napaZoom).toBeGreaterThan(13)

			await centerButton(page).click()

			// The map pans onto the granted position…
			await expect
				.poll(
					async () => {
						const center = await readMapCenter(page)
						return (
							center !== null &&
							Math.abs(center.lng - SONOMA_PLAZA.longitude) < 0.02 &&
							Math.abs(center.lat - SONOMA_PLAZA.latitude) < 0.02
						)
					},
					{ timeout: 15_000 }
				)
				.toBe(true)

			// …and zooms to 13.
			const afterZoom = Number(
				await page.locator('.listings-map').getAttribute('data-map-zoom')
			)
			expect(afterZoom).toBeCloseTo(13, 1)
		} finally {
			await cleanupTestUser(owner)
		}
	})
})

test.describe('Home map — Center button when geolocation is denied', () => {
	test.use({ permissions: [] })

	test('leaves the map on Napa when the position is denied', async ({
		page,
	}) => {
		test.slow()
		const owner = await createTestUser()
		await createTestListing(owner.id, { name: 'Napa lemons' })

		try {
			await page.goto('/')
			await expect(page.locator('.listings-map')).toBeVisible({ timeout: 15_000 })

			await expect
				.poll(
					async () => {
						const center = await readMapCenter(page)
						return center !== null && center.lng > -122.35
					},
					{ timeout: 15_000 }
				)
				.toBe(true)

			await centerButton(page).click()

			// Denial is silent and leaves the map where it was — never near Sonoma.
			await page.waitForTimeout(1_000)
			const center = await readMapCenter(page)
			expect(center!.lng).toBeGreaterThan(-122.35)
			expect(Math.abs(center!.lng - SONOMA_PLAZA.longitude)).toBeGreaterThan(0.1)
		} finally {
			await cleanupTestUser(owner)
		}
	})
})
