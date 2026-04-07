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

		const uploadDone = page.waitForResponse((r) => r.url().includes('_server'))
		await page
			.getByLabel(/Add photo/i)
			.setInputFiles('tests/fixtures/test-photo.png')
		await uploadDone

		await expect(page.getByRole('img', { name: /listing photo/i })).toBeVisible()
	})
})
