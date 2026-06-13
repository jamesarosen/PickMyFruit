import { test, expect } from './helpers/fixtures'
import { createTestListing, getListingLocation } from './helpers/test-db'
import { loginViaUI } from './helpers/login'

/** Sonoma Plaza — a granted position clearly distinct from the Napa fallback. */
const GRANTED_POSITION = { latitude: 38.291859, longitude: -122.458036 }

/** The fallback bias when the user denies the geolocation request. */
const NAPA_CITY_HALL = { lat: 38.2967151, lng: -122.292037 }

test.describe('Address suggestions — geolocation granted', () => {
	test.use({
		geolocation: GRANTED_POSITION,
		permissions: ['geolocation'],
	})

	test('prepopulates the address from the user’s position and submits with its coordinates', async ({
		page,
		testUser,
		photonMock,
		nominatimMock,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		// The granted position is reverse-geocoded into the address field.
		const address = page.getByLabel('Address', { exact: true })
		await expect(address).toHaveValue(/1600 Reverse Road/, { timeout: 10_000 })
		await expect(address).toHaveValue(/Sonoma/)
		expect(photonMock.reverseCallCount).toBe(1)
		expect(photonMock.lastReverse!.lat).toBeCloseTo(GRANTED_POSITION.latitude, 5)
		expect(photonMock.lastReverse!.lng).toBeCloseTo(GRANTED_POSITION.longitude, 5)

		// The guess is announced and visibly flagged for verification.
		await expect(
			page.getByText(/Filled in from your current location/i)
		).toBeVisible()

		// The prepopulated address behaves like a picked suggestion: it already
		// carries coordinates, so submitting needs no search and no geocoding.
		await page.locator('.combobox__trigger').click()
		await page.locator('.combobox__item').filter({ hasText: 'Avocado' }).click()
		await page.getByLabel(/When to Pick/i).fill('July–September')
		await page.getByRole('button', { name: 'Share my produce' }).click()

		await expect(page).toHaveURL(/\/listings\/\d+/, { timeout: 10_000 })
		expect(photonMock.callCount).toBe(0)
		expect(nominatimMock.callCount).toBe(0)

		const listingId = Number(page.url().match(/\/listings\/(\d+)/)![1])
		const stored = await getListingLocation(listingId)
		expect(stored).toBeDefined()
		expect(stored!.lat).toBeCloseTo(GRANTED_POSITION.latitude, 5)
		expect(stored!.lng).toBeCloseTo(GRANTED_POSITION.longitude, 5)
		expect(stored!.city).toBe('Sonoma')
	})

	test('searches carry the user’s position as the location bias', async ({
		page,
		testUser,
		photonMock,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		// Wait for prepopulation so the position has definitely resolved, then
		// search for something else.
		const address = page.getByLabel('Address', { exact: true })
		await expect(address).toHaveValue(/1600 Reverse Road/, { timeout: 10_000 })
		await address.fill('400 School St')
		await page.getByRole('option', { name: /School Street/ }).click()

		const bias = photonMock.biasFor('400 School St')
		expect(bias).toBeDefined()
		expect(bias!.lat).toBeCloseTo(GRANTED_POSITION.latitude, 5)
		expect(bias!.lng).toBeCloseTo(GRANTED_POSITION.longitude, 5)
	})

	test('does not overwrite the pre-fill from the last listing', async ({
		page,
		testUser,
		photonMock,
	}) => {
		await createTestListing(testUser.id, {
			address: '456 Oak Avenue',
			city: 'St. Helena',
			state: 'CA',
			zip: '94574',
		})

		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		const address = page.getByLabel('Address', { exact: true })
		await expect(address).toHaveValue(/456 Oak Avenue/, { timeout: 10_000 })

		// The produce-type selector renders client-side only, so its presence
		// proves hydration finished and the address input's handlers are live.
		await page.locator('.combobox__trigger').click()
		await page.locator('.combobox__item').filter({ hasText: 'Avocado' }).click()

		// Searching with the granted bias proves the position resolved — and
		// the resolution path must have skipped the reverse geocode.
		await address.fill('400 School St')
		await page.getByRole('option', { name: /School Street/ }).click()
		const bias = photonMock.biasFor('400 School St')
		expect(bias!.lat).toBeCloseTo(GRANTED_POSITION.latitude, 5)
		expect(photonMock.reverseCallCount).toBe(0)
		await expect(address).toHaveValue(/400 School Street/)
	})
})

test.describe('Address suggestions — geolocation denied', () => {
	// Playwright denies geolocation unless the permission is granted, so the
	// component’s error path runs immediately — no prompt is shown.
	test.use({ permissions: [] })

	test('falls back to the Napa City Hall bias and leaves the field empty', async ({
		page,
		testUser,
		photonMock,
	}) => {
		// Surface the denial on `window` — otherwise "the field stays empty"
		// could be asserted while the geolocation outcome is still pending,
		// proving nothing.
		await page.addInitScript(() => {
			const geolocation = navigator.geolocation
			const original = geolocation.getCurrentPosition.bind(geolocation)
			geolocation.getCurrentPosition = (onSuccess, onError, options) =>
				original(
					onSuccess,
					(error) => {
						;(window as { __geolocationDenied?: boolean }).__geolocationDenied = true
						onError?.(error)
					},
					options
				)
		})

		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		// The produce-type selector renders client-side only, so its presence
		// proves hydration finished and the address input's handlers are live.
		await page.locator('.combobox__trigger').click()
		await page.locator('.combobox__item').filter({ hasText: 'Avocado' }).click()

		await page.waitForFunction(
			() => (window as { __geolocationDenied?: boolean }).__geolocationDenied
		)
		const address = page.getByLabel('Address', { exact: true })
		await expect(address).toHaveValue('')

		await address.fill('400 School St')
		await page.getByRole('option', { name: /School Street/ }).click()

		const bias = photonMock.biasFor('400 School St')
		expect(bias).toBeDefined()
		expect(bias!.lat).toBeCloseTo(NAPA_CITY_HALL.lat, 5)
		expect(bias!.lng).toBeCloseTo(NAPA_CITY_HALL.lng, 5)
		expect(photonMock.reverseCallCount).toBe(0)
		await expect(address).toHaveValue(/400 School Street/)
	})
})
