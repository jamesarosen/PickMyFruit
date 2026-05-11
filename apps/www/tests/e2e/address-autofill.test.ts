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

		await expect(page.getByLabel(/Address/)).toHaveValue('', { timeout: 10000 })
		await expect(page.getByLabel('City')).toHaveValue('Napa', { timeout: 10000 })
		await expect(page.getByLabel('State')).toHaveValue('CA', { timeout: 10000 })

		// No prefill notice
		await expect(page.locator('.form-prefill-notice')).not.toBeAttached()
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

		await expect(page.getByLabel(/Address/)).toHaveValue('456 Oak Avenue', {
			timeout: 10000,
		})
		await expect(page.getByLabel('City')).toHaveValue('St. Helena', {
			timeout: 10000,
		})
		await expect(page.getByLabel('State')).toHaveValue('CA', { timeout: 10000 })
		await expect(page.getByLabel('ZIP')).toHaveValue('94574', { timeout: 10000 })

		// Prefill notice is visible
		const notice = page.locator('.form-prefill-notice')
		await expect(notice).toBeVisible()
		await expect(notice).toContainText('Pre-filled from your last listing')
	})
})
