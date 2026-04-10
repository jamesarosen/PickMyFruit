import { test, expect } from './helpers/fixtures'
import { createTestListing } from './helpers/test-db'
import { loginViaUI } from './helpers/login'

test.describe('Listing Status', () => {
	test.describe.configure({ mode: 'serial' })

	test('owner can change listing status from available to unavailable', async ({
		page,
		testUser,
		testListing,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto(`/listings/${testListing.id}`)

		const availableRadio = page.getByRole('radio', { name: /^Available / })
		const unavailableRadio = page.getByRole('radio', { name: /^Unavailable / })

		await expect(availableRadio).toBeVisible({ timeout: 10000 })
		await expect(availableRadio).toBeChecked()
		await expect(unavailableRadio).not.toBeChecked()

		await unavailableRadio.click()
		await expect(unavailableRadio).toBeChecked({ timeout: 10000 })
		await expect(availableRadio).not.toBeChecked()
	})

	test('owner can change listing status back to available', async ({
		page,
		testUser,
	}) => {
		const listing = await createTestListing(testUser.id, {
			status: 'unavailable',
		})

		await loginViaUI(page, testUser)
		await page.goto(`/listings/${listing.id}`)

		const availableRadio = page.getByRole('radio', { name: /^Available / })
		const unavailableRadio = page.getByRole('radio', { name: /^Unavailable / })

		await expect(unavailableRadio).toBeVisible({ timeout: 10000 })
		await expect(unavailableRadio).toBeChecked()

		await availableRadio.click()
		await expect(availableRadio).toBeChecked({ timeout: 10000 })
	})

	test('owner can set listing status to private', async ({ page, testUser }) => {
		const listing = await createTestListing(testUser.id, {
			status: 'available',
		})

		await loginViaUI(page, testUser)
		await page.goto(`/listings/${listing.id}`)

		const privateRadio = page.getByRole('radio', { name: /^Private / })

		await expect(privateRadio).toBeVisible({ timeout: 10000 })
		await expect(privateRadio).not.toBeChecked()

		await privateRadio.click()
		await expect(privateRadio).toBeChecked({ timeout: 10000 })
	})

	test('unavailable listing shows unavailable message on detail page', async ({
		page,
		testUser,
	}) => {
		const listing = await createTestListing(testUser.id, {
			status: 'unavailable',
		})

		await page.goto(`/listings/${listing.id}`)

		await expect(
			page.getByText('This listing is currently unavailable')
		).toBeVisible()
		await expect(
			page.getByText('Check back later or browse other available listings.')
		).toBeVisible()
	})
})
