import { test, expect } from './helpers/fixtures'
import { loginViaUI } from './helpers/login'

/**
 * Outer-loop coverage for docs/0011-international-address-entry.md:
 * the "Where is it?" section is a single address autosuggest backed by
 * Photon, with a structured manual-entry fallback geocoded via Nominatim.
 */
test.describe('International address entry', () => {
	test('creates a listing from an international autosuggest selection', async ({
		page,
		testUser,
		photonMock,
		nominatimMock,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		await page.locator('.combobox__trigger').click()
		await page.locator('.combobox__item').filter({ hasText: 'Avocado' }).click()
		await page.getByLabel(/When to Pick/i).fill('July–September')

		// Typing fetches suggestions; picking one supplies address + coords.
		await page
			.getByLabel('Address', { exact: true })
			.fill('12 Rue de la Paix, Paris')
		await page
			.getByRole('option', { name: /Rue de la Paix.*Paris.*France/ })
			.click()
		expect(photonMock.callCount).toBeGreaterThan(0)

		await page.getByRole('button', { name: 'Share my produce' }).click()

		await expect(page).toHaveURL(/\/listings\/\d+/, { timeout: 10_000 })
		await expect(
			page.getByText('Paris, Île-de-France, France').first()
		).toBeVisible()

		// The selection carried its own coordinates — no geocoding round-trip.
		expect(nominatimMock.callCount).toBe(0)
	})

	test('creates a listing via manual entry when the address is not suggested', async ({
		page,
		testUser,
		nominatimMock,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		await page.locator('.combobox__trigger').click()
		await page.locator('.combobox__item').filter({ hasText: 'Avocado' }).click()
		await page.getByLabel(/When to Pick/i).fill('July–September')

		await page.getByRole('button', { name: /enter it manually/i }).click()

		await page.getByLabel(/Street Address/i).fill('1 Rural Lane')
		// Kobalte renders required labels as "City *", so substring-match.
		await page.getByLabel('City').fill('Smallville')
		await page.getByLabel(/State \/ Province \/ Region/i).fill('Otago')
		await page.getByLabel(/Postal code/i).fill('9376')
		await page.getByLabel('Country', { exact: true }).selectOption('NZ')

		await page.getByRole('button', { name: 'Share my produce' }).click()

		await expect(page).toHaveURL(/\/listings\/\d+/, { timeout: 10_000 })
		await expect(
			page.getByText('Smallville, Otago, New Zealand').first()
		).toBeVisible()

		// Manual entry falls back to submit-time geocoding.
		expect(nominatimMock.callCount).toBeGreaterThan(0)
	})

	test('offers manual entry when no suggestions match', async ({
		page,
		testUser,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		// The produce-type combobox renders client-side only; its appearance
		// signals hydration is complete and the address field's handlers are
		// attached.
		await expect(page.locator('.combobox__trigger')).toBeVisible()
		await page.getByLabel('Address', { exact: true }).fill('Road to Nowhere')

		// The empty result set surfaces the manual-entry affordance inline.
		await expect(page.getByText(/No matching addresses/i)).toBeVisible()
		await page.getByRole('button', { name: /enter it manually/i }).click()
		await expect(page.getByLabel(/Street Address/i)).toBeVisible()
	})
})
