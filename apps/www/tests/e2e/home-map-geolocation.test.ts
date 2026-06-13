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

test.describe('Home map — geolocation granted', () => {
	test.use({ geolocation: SONOMA_PLAZA, permissions: ['geolocation'] })

	test('centers the map on the user’s position', async ({ page }) => {
		test.slow()
		const owner = await createTestUser()
		// A listing makes the "Available Now" map render at all.
		await createTestListing(owner.id, { name: 'Napa lemons' })

		try {
			await page.goto('/')
			await expect(page.locator('.listings-map')).toBeVisible({ timeout: 15_000 })

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
		} finally {
			await cleanupTestUser(owner)
		}
	})
})

test.describe('Home map — position arrives after the map loads', () => {
	test.use({ geolocation: SONOMA_PLAZA, permissions: ['geolocation'] })

	test('re-centers via the deferred flyTo once the position resolves', async ({
		page,
	}) => {
		test.slow()
		// Hold the position until the test releases it, so the map is guaranteed to
		// build with the Napa fallback first — this exercises the deferred
		// re-center path, not the initial camera.
		await page.addInitScript(() => {
			const geolocation = navigator.geolocation
			const original = geolocation.getCurrentPosition.bind(geolocation)
			geolocation.getCurrentPosition = (onSuccess, onError, options) => {
				;(window as { __releaseGeolocation?: () => void }).__releaseGeolocation =
					() => original(onSuccess, onError, options)
			}
		})

		const owner = await createTestUser()
		await createTestListing(owner.id, { name: 'Napa lemons' })

		try {
			await page.goto('/')
			await expect(page.locator('.listings-map')).toBeVisible({ timeout: 15_000 })

			// The map frames the held-back fallback (central Napa) first.
			await expect
				.poll(
					async () => {
						const center = await readMapCenter(page)
						return center !== null && center.lng > -122.35
					},
					{ timeout: 15_000 }
				)
				.toBe(true)

			// Release the position; the deferred effect must fly to it.
			await page.evaluate(() =>
				(window as { __releaseGeolocation?: () => void }).__releaseGeolocation?.()
			)

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
		} finally {
			await cleanupTestUser(owner)
		}
	})
})

test.describe('Home map — geolocation denied', () => {
	// Playwright denies geolocation unless the permission is granted, so the
	// fallback path runs immediately — no prompt is shown.
	test.use({ permissions: [] })

	test('falls back to Napa, never the user’s position', async ({ page }) => {
		test.slow()
		const owner = await createTestUser()
		// Default test listing sits in central Napa (38.3, -122.3).
		await createTestListing(owner.id, { name: 'Napa lemons' })

		try {
			await page.goto('/')
			await expect(page.locator('.listings-map')).toBeVisible({ timeout: 15_000 })

			await expect
				.poll(
					async () => {
						const center = await readMapCenter(page)
						// Central Napa is east of -122.35; Sonoma Plaza is at -122.458.
						return center !== null && center.lng > -122.35
					},
					{ timeout: 15_000 }
				)
				.toBe(true)

			const center = await readMapCenter(page)
			expect(Math.abs(center!.lng - SONOMA_PLAZA.longitude)).toBeGreaterThan(0.1)
		} finally {
			await cleanupTestUser(owner)
		}
	})
})
