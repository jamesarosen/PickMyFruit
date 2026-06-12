import { test, expect } from './helpers/fixtures'
import { loginViaUI } from './helpers/login'

test.describe('Profile', () => {
	// Run serially to avoid SQLite lock conflicts from parallel DB writes
	test.describe.configure({ mode: 'serial' })

	test('redirects to login when unauthenticated', async ({ page }) => {
		await page.goto('/profile')
		await expect(page).toHaveURL('/login?returnTo=%2Fprofile')
	})

	test('user can update their name and it persists', async ({
		page,
		testUser,
	}) => {
		await loginViaUI(page, testUser)

		await page.goto('/profile')
		await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible()

		// Email is shown but immutable
		const emailInput = page.getByLabel('Email Address')
		await expect(emailInput).toBeDisabled()
		await expect(emailInput).toHaveValue(testUser.email)

		const nameInput = page.getByLabel('Your name')
		await nameInput.fill('Rosa Rugosa')
		await page.getByRole('button', { name: 'Save' }).click()

		await expect(page.getByRole('status')).toHaveText('Saved!')

		// A full reload re-derives the value from the server session, proving
		// the update persisted rather than living in component state.
		await page.reload()
		await expect(page.getByLabel('Your name')).toHaveValue('Rosa Rugosa')
	})
})
