import type { Page } from '@playwright/test'
import { test, expect } from './helpers/fixtures'
import { type TestUser, getMagicLinkToken } from './helpers/test-db'

/** Signs in via magic link and waits for redirect to /listings/mine. */
async function signIn(page: Page, testUser: TestUser) {
	await page.goto('/login')
	await expect(
		page.getByRole('heading', { name: 'Sign in to Pick My Fruit' })
	).toBeVisible()

	const emailInput = page.locator('input#email')
	await expect(emailInput).toBeVisible()
	await emailInput.pressSequentially(testUser.email, { delay: 30 })
	await expect(emailInput).toHaveValue(testUser.email)

	const responsePromise = page.waitForResponse((resp) =>
		resp.url().includes('/api/auth/sign-in/magic-link')
	)
	await page.locator('button.submit-button').click()
	await responsePromise

	await expect(
		page.getByRole('heading', { name: 'Check your email' })
	).toBeVisible({ timeout: 10000 })

	const token = await getMagicLinkToken(testUser.email)
	await page
		.locator('input#magic-link-token')
		.pressSequentially(token, { delay: 20 })
	await page.getByRole('button', { name: 'Verify' }).click()

	await expect(page).toHaveURL('/listings/mine')
}

test.describe('Authentication', () => {
	// Run serially to avoid SQLite lock conflicts from parallel DB writes
	test.describe.configure({ mode: 'serial' })

	test('magic link sign-in flow', async ({ page, testUser }) => {
		await signIn(page, testUser)
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

	test('session survives page refresh', async ({ page, testUser }) => {
		await signIn(page, testUser)

		await expect(page.getByRole('link', { name: 'My Garden' })).toBeVisible()

		await page.reload()

		await expect(page.getByRole('link', { name: 'My Garden' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'Sign In' })).not.toBeVisible()
	})

	test('sign-out redirects from protected page', async ({ page, testUser }) => {
		await signIn(page, testUser)

		await page.getByRole('button', { name: 'Sign Out' }).click()

		await expect(page).toHaveURL('/')
		await expect(page.getByRole('link', { name: 'Sign In' })).toBeVisible()
		await expect(page.getByRole('link', { name: 'My Garden' })).not.toBeVisible()
	})
})
