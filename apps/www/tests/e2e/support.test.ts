import { test, expect } from './helpers/fixtures'

test.describe('Support flow', () => {
	test('/support page loads and /support/go redirects to BMAC', async ({
		page,
	}) => {
		await page.goto('/support')

		await expect(
			page.getByRole('heading', { name: 'Keep Pick My Fruit Running' })
		).toBeVisible()

		// Intercept the outbound redirect so the test never hits buymeacoffee.com.
		const goUrl = new URL('/support/go', page.url()).toString()
		const response = await page.request.get(goUrl, { maxRedirects: 0 })
		expect(response.status()).toBe(302)
		expect(response.headers()['location']).toBe(
			'https://buymeacoffee.com/jamesarosen'
		)
	})
})
