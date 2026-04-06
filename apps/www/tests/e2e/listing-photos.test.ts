import { test, expect } from './helpers/fixtures'
import { loginViaUI } from './helpers/login'

test.describe('Listing photos', () => {
	test.describe.configure({ mode: 'serial' })

	test('owner can upload a photo that appears on the listing detail', async ({
		page,
		testUser,
		testListing,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto(`/listings/${testListing.id}`)

		await page
			.getByLabel(/Add photos/i)
			.setInputFiles('tests/fixtures/test-photo.png')

		const uploadDone = page.waitForResponse(
			(r) => r.url().includes('/photos') && r.status() === 201
		)
		await page.getByRole('button', { name: /Upload/i }).click()
		await uploadDone

		await expect(page.getByRole('img', { name: /listing photo/i })).toBeVisible()
	})
})
