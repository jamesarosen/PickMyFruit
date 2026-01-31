import { test, expect } from './helpers/fixtures'
import { getMagicLinkToken } from './helpers/test-db'

test.describe('Authentication', () => {
	// Run serially to avoid SQLite lock conflicts from parallel DB writes
	test.describe.configure({ mode: 'serial' })

	test('magic link sign-in flow', async ({ page, testUser }) => {
		await page.goto('/login')

		await expect(
			page.getByRole('heading', { name: 'Sign in to Pick My Fruit' })
		).toBeVisible()

		const emailInput = page.locator('input#email')
		await expect(emailInput).toBeVisible()
		await emailInput.pressSequentially(testUser.email, { delay: 30 })
		await expect(emailInput).toHaveValue(testUser.email)

		const submitButton = page.locator('button.submit-button')
		await submitButton.click()
		await expect(
			page.getByRole('heading', { name: 'Check your email' })
		).toBeVisible({ timeout: 15000 })

		const token = await getMagicLinkToken(testUser.email)
		const tokenInput = page.locator('input#magic-link-token')
		await tokenInput.pressSequentially(token, { delay: 20 })
		await page.getByRole('button', { name: 'Verify' }).click()

		await expect(page).toHaveURL('/garden/mine')
	})

	test('protected route redirects to login', async ({ page }) => {
		await page.goto('/garden/mine')
		await expect(page).toHaveURL('/login')
	})

	test('invalid token shows error', async ({ page, testUser }) => {
		await page.goto('/login')

		await expect(
			page.getByRole('heading', { name: 'Sign in to Pick My Fruit' })
		).toBeVisible()

		const emailInput = page.locator('input#email')
		await expect(emailInput).toBeVisible()
		await emailInput.pressSequentially(testUser.email, { delay: 30 })
		await expect(emailInput).toHaveValue(testUser.email)

		const submitButton = page.locator('button.submit-button')
		await submitButton.click()
		await expect(
			page.getByRole('heading', { name: 'Check your email' })
		).toBeVisible({ timeout: 15000 })

		const tokenInput = page.locator('input#magic-link-token')
		await tokenInput.pressSequentially('invalid-token-12345', { delay: 20 })

		await page.getByRole('button', { name: 'Verify' }).click()
		await expect(page.locator('.token-error')).toBeVisible({ timeout: 15000 })
	})
})
