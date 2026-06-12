import { test, expect } from './helpers/fixtures'

test.describe('Home page geolocation', () => {
	test.describe.configure({ mode: 'serial' })

	test.describe('with permission granted', () => {
		test.use({
			geolocation: { latitude: 38.31, longitude: -122.3 },
			permissions: ['geolocation'],
		})

		test('near-me button puts rounded coords in the URL; reset clears them', async ({
			page,
			testListing,
		}) => {
			// Cold-compiling the maplibre chunk can stall hydration well past the
			// default timeout when this file runs standalone.
			test.setTimeout(120_000)
			await page.goto('/')

			// Retry the click until hydration has attached the handler.
			await expect(async () => {
				await page.getByRole('button', { name: 'Show listings near me' }).click()
				await expect(page).toHaveURL(/lat=38\.31/, { timeout: 2_000 })
			}).toPass({ timeout: 90_000 })
			await expect(page).toHaveURL(/lng=-122\.3/)

			// Proximity ordering has no radius cutoff — the listing stays visible.
			await expect(
				page.locator(`a[href="/listings/${testListing.id}"]`)
			).toBeVisible()

			await page.getByRole('button', { name: 'Reset to Napa' }).click()
			await expect(page).not.toHaveURL(/lat=/)
			await expect(
				page.locator(`a[href="/listings/${testListing.id}"]`)
			).toBeVisible()
		})
	})

	test('shows an error when the browser denies location access', async ({
		page,
		testListing: _,
	}) => {
		test.setTimeout(120_000)
		// No geolocation permission granted, so getCurrentPosition fails.
		await page.goto('/')

		await expect(async () => {
			await page.getByRole('button', { name: 'Show listings near me' }).click()
			await expect(page.getByText(/couldn't get your location/i)).toBeVisible({
				timeout: 2_000,
			})
		}).toPass({ timeout: 90_000 })
	})
})
