import { test, expect } from './helpers/fixtures'
import { getMagicLinkToken } from './helpers/test-db'

test.describe('Authentication', () => {
	// Run serially to avoid SQLite lock conflicts from parallel DB writes
	test.describe.configure({ mode: 'serial' })

	test('magic link sign-in flow', async ({ page, testUser }) => {
		await page.goto('/login')

		// Wait for login page to fully load
		await expect(
			page.getByRole('heading', { name: 'Sign in to Pick My Fruit' })
		).toBeVisible()

		// Wait for form to be ready
		const emailInput = page.locator('input#email')
		await expect(emailInput).toBeVisible()

		// Type email using pressSequentially which properly triggers input events
		await emailInput.pressSequentially(testUser.email, { delay: 30 })

		// Verify the email was entered correctly
		await expect(emailInput).toHaveValue(testUser.email)

		// Submit the form and wait for network response
		const submitButton = page.locator('button.submit-button')
		const responsePromise = page.waitForResponse((resp) =>
			resp.url().includes('/api/auth/sign-in/magic-link')
		)
		await submitButton.click()
		await responsePromise

		// Wait for "Check your email" view
		await expect(
			page.getByRole('heading', { name: 'Check your email' })
		).toBeVisible({ timeout: 10000 })

		// Get token from database and verify
		const token = await getMagicLinkToken(testUser.email)
		const tokenInput = page.locator('input#magic-link-token')
		await tokenInput.pressSequentially(token, { delay: 20 })
		await page.getByRole('button', { name: 'Verify' }).click()

		// Should redirect to garden
		await expect(page).toHaveURL('/garden/mine')
	})

	test('protected route redirects to login', async ({ page }) => {
		await page.goto('/garden/mine')
		await expect(page).toHaveURL('/login')
	})

	test('invalid token shows error', async ({ page, testUser }) => {
		await page.goto('/login')

		// Wait for login page to fully load (same as first test)
		await expect(
			page.getByRole('heading', { name: 'Sign in to Pick My Fruit' })
		).toBeVisible()

		// Wait for form to be ready (same as first test)
		const emailInput = page.locator('input#email')
		await expect(emailInput).toBeVisible()

		// Type email using pressSequentially (same as first test)
		await emailInput.pressSequentially(testUser.email, { delay: 30 })
		await expect(emailInput).toHaveValue(testUser.email)

		// Submit the form (same as first test)
		const submitButton = page.locator('button.submit-button')
		const responsePromise = page.waitForResponse((resp) =>
			resp.url().includes('/api/auth/sign-in/magic-link')
		)
		await submitButton.click()
		await responsePromise

		// Wait for "Check your email" view (same as first test)
		await expect(
			page.getByRole('heading', { name: 'Check your email' })
		).toBeVisible({ timeout: 10000 })

		// Enter invalid token
		const tokenInput = page.locator('input#magic-link-token')
		await tokenInput.pressSequentially('invalid-token-12345', { delay: 20 })

		// Click verify and wait for response
		const verifyResponsePromise = page.waitForResponse((resp) =>
			resp.url().includes('/api/auth/magic-link/verify')
		)
		await page.getByRole('button', { name: 'Verify' }).click()
		await verifyResponsePromise

		// Should show error
		await expect(page.locator('.token-error')).toBeVisible({ timeout: 10000 })
	})
})
