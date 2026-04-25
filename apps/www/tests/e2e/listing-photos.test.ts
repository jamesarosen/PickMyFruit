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
		await page.waitForLoadState('networkidle')

		const uploadDone = page.waitForResponse((r) => r.url().includes('/_serverFn'))
		await page
			.getByLabel(/Add photo/i)
			.setInputFiles('tests/fixtures/test-photo.png')
		await uploadDone

		const photo = page.getByRole('img', { name: /listing photo/i })
		await expect(photo).toBeVisible()
		const photoSrc = await photo.getAttribute('src')
		expect(photoSrc).toContain('/api/uploads/pub/listing_photos/')

		const photoResponse = await page.request.get(photoSrc!)
		expect(photoResponse.ok()).toBeTruthy()
		expect(photoResponse.headers()['content-type']).toContain('image/jpeg')
	})
})
