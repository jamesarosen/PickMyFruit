import { test, expect } from './helpers/fixtures'

test.describe('Support flow', () => {
	test('header Support link → /support page → /support/go redirect to BMAC', async ({
		page,
	}) => {
		await page.goto('/')

		await page.getByRole('link', { name: 'Support', exact: true }).first().click()

		await expect(page).toHaveURL(/\/support\?from=header$/)
		await expect(
			page.getByRole('heading', { name: 'Keep Pick My Fruit Running' })
		).toBeVisible()

		// Intercept the outbound redirect so the test never hits buymeacoffee.com.
		const goUrl = new URL('/support/go?from=header', page.url()).toString()
		const response = await page.request.get(goUrl, { maxRedirects: 0 })
		expect(response.status()).toBe(302)
		expect(response.headers()['location']).toBe(
			'https://buymeacoffee.com/jamesarosen'
		)
	})
})
