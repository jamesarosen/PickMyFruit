import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { getMagicLinkToken, type TestUser } from './test-db'

/** Logs in a test user via the magic link UI flow. */
export async function loginViaUI(page: Page, testUser: TestUser) {
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
