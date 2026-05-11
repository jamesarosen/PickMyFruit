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
		await page.waitForLoadState('networkidle', { timeout: 60_000 })

		const photoInput = page.getByLabel(/Add photo/i)
		await expect(photoInput).toBeVisible({ timeout: 10000 })
		await expect(photoInput).toBeEnabled({ timeout: 10000 })

		await photoInput.setInputFiles('tests/fixtures/test-photo.png')
		await expect(
			page.locator('.listing-photos-section [aria-live="polite"]')
		).toContainText('Photo uploaded', { timeout: 25000 })

		const photo = page.getByRole('img', { name: /listing photo/i })
		await expect(photo).toBeVisible({ timeout: 10000 })
		const photoSrc = await photo.getAttribute('src')
		expect(photoSrc).toContain('/api/uploads/pub/listing_photos/')

		const photoResponse = await page.request.get(photoSrc!)
		expect(photoResponse.ok()).toBeTruthy()
		expect(photoResponse.headers()['content-type']).toContain('image/jpeg')
	})
})
