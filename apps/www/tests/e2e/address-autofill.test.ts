import { test, expect } from './helpers/fixtures'
import { createTestListing } from './helpers/test-db'
import { loginViaUI } from './helpers/login'

test.describe('Address Autofill', () => {
	test('shows default city/state for first-time user', async ({
		page,
		testUser,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		await expect(page.locator('input#address')).toHaveValue('')
		await expect(page.locator('input#city')).toHaveValue('Napa')
		await expect(page.locator('input#state')).toHaveValue('CA')

		// No prefill notice
		await expect(page.locator('.form-prefill-notice')).not.toBeVisible()
	})

	test('pre-fills address from most recent listing', async ({
		page,
		testUser,
	}) => {
		await createTestListing(testUser.id, {
			address: '456 Oak Avenue',
			city: 'St. Helena',
			state: 'CA',
			zip: '94574',
		})

		await loginViaUI(page, testUser)
		await page.goto('/listings/new')

		await expect(page.locator('input#address')).toHaveValue('456 Oak Avenue')
		await expect(page.locator('input#city')).toHaveValue('St. Helena')
		await expect(page.locator('input#state')).toHaveValue('CA')
		await expect(page.locator('input#zip')).toHaveValue('94574')

		// Prefill notice is visible
		const notice = page.locator('.form-prefill-notice')
		await expect(notice).toBeVisible()
		await expect(notice).toContainText('Pre-filled from your last listing')
	})
})
