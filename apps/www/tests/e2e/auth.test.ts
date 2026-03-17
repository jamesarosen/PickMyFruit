import { test, expect } from './helpers/fixtures'
import { loginViaUI } from './helpers/login'
import { pageHeader } from './helpers/page-header'

test.describe('Authentication', () => {
	// Run serially to avoid SQLite lock conflicts from parallel DB writes
	test.describe.configure({ mode: 'serial' })

	test('magic link sign-in flow', async ({ page, testUser }) => {
		await loginViaUI(page, testUser)
	})

	test('protected route redirects to login', async ({ page }) => {
		await page.goto('/listings/mine')
		await expect(page).toHaveURL('/login?returnTo=%2Flistings%2Fmine')
	})

	test('invalid token shows error', async ({ page, testUser }) => {
		await page.goto('/login')

		// Wait for login page to fully load (same as first test)
		await expect(
			page.getByRole('heading', { name: 'Sign in to Pick My Fruit' })
		).toBeVisible()

		// Wait for form to be ready (same as first test)
		const emailInput = page.getByLabel(/email/i)
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

	test('session survives page refresh', async ({ page, testUser }) => {
		await loginViaUI(page, testUser)

		const nav = pageHeader(page)
		expect(await nav.isSignedIn()).toBeTruthy()

		await page.reload()

		await expect(page).toHaveURL('/listings/mine')
		expect(await nav.isSignedIn()).toBeTruthy()
	})

	test('sign-out redirects from protected page', async ({ page, testUser }) => {
		await loginViaUI(page, testUser)

		const nav = pageHeader(page)
		await nav.signOut()

		await expect(page).toHaveURL('/')
		expect(await nav.isSignedIn()).toBeFalsy()
	})
})
