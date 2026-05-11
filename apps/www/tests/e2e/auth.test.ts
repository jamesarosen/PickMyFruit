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
		const submitButton = page.getByRole('button', { name: /send sign-in link/i })
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

		// Wait for the UI to reflect the rejection. better-auth's client calls
		// the verify endpoint with `redirect: 'manual'`, and the server responds
		// with a 302 to an error callback. Playwright's `waitForResponse` does
		// not fire for these manual-redirect responses, even though the request
		// completes and the app reacts to it. Polling on the visible error
		// message is the reliable signal.
		await page.getByRole('button', { name: 'Verify' }).click()
		await expect(page.locator('.token-error')).toBeVisible({ timeout: 10000 })
	})

	test('session survives page refresh', async ({ page, testUser }) => {
		await loginViaUI(page, testUser)

		const nav = pageHeader(page)
		// Vite dev mode may reload the page when loading new modules on first visit.
		// Poll until the session is established rather than asserting immediately.
		await expect.poll(() => nav.isSignedIn(), { timeout: 10000 }).toBeTruthy()

		await page.reload()

		await expect(page).toHaveURL('/listings/mine')
		await expect.poll(() => nav.isSignedIn(), { timeout: 5000 }).toBeTruthy()
	})

	test('sign-out redirects from protected page', async ({ page, testUser }) => {
		await loginViaUI(page, testUser)

		const nav = pageHeader(page)
		// Wait for page to settle (Vite may reload on first visit to mine page)
		await expect.poll(() => nav.isSignedIn(), { timeout: 10000 }).toBeTruthy()
		await nav.signOut()

		await expect(page).toHaveURL('/')
		expect(await nav.isSignedIn()).toBeFalsy()
	})
})
