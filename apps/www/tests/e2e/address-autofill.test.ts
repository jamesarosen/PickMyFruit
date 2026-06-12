import { test, expect } from './helpers/fixtures'
import { createTestListing } from './helpers/test-db'
import { loginViaUI } from './helpers/login'

test.describe('Address Autofill', () => {
	test('shows an empty address field for first-time user', async ({
		page,
		testUser,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		await expect(page.getByLabel('Address', { exact: true })).toHaveValue('', {
			timeout: 10000,
		})

		// No prefill notice
		await expect(page.locator('.form-prefill-notice')).not.toBeAttached()
	})

	test('pre-fills address from most recent listing', async ({
		page,
		testUser,
		photonMock,
		nominatimMock,
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
		await expect(address).toHaveValue(/456 Oak Avenue/, { timeout: 10000 })
		await expect(address).toHaveValue(/St\. Helena/)

		// Prefill notice is visible
		const notice = page.locator('.form-prefill-notice')
		await expect(notice).toBeVisible()
		await expect(notice).toContainText('Pre-filled from your last listing')

		// An untouched pre-fill reuses the stored coordinates: submitting must
		// not trigger a suggestion fetch or a geocoding round-trip.
		await page.locator('.combobox__trigger').click()
		await page.locator('.combobox__item').filter({ hasText: 'Avocado' }).click()
		await page.getByLabel(/When to Pick/i).fill('July–September')
		await page.getByRole('button', { name: 'Share my produce' }).click()

		await expect(page).toHaveURL(/\/listings\/\d+/, { timeout: 10_000 })
		expect(photonMock.callCount).toBe(0)
		expect(nominatimMock.callCount).toBe(0)
	})
})
