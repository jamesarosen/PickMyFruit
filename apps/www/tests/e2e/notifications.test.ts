import { test, expect } from './helpers/fixtures'
import { loginViaUI } from './helpers/login'

test.describe('Notifications', () => {
	// Run serially to avoid SQLite lock conflicts from parallel DB writes
	test.describe.configure({ mode: 'serial' })

	test('redirects to login when unauthenticated', async ({ page }) => {
		await page.goto('/notifications')
		await expect(page).toHaveURL('/login?returnTo=%2Fnotifications')
	})

	// The E2E environment runs EMAIL_PROVIDER=silent, so the loader reports
	// notifications as unavailable. This still exercises the full pipeline:
	// auth middleware, the getNotifications server fn, and the SSR render.
	test('renders the not-configured state for this environment', async ({
		page,
		testUser,
	}) => {
		await loginViaUI(page, testUser)

		await page.goto('/notifications')
		await expect(
			page.getByRole('heading', { name: 'Manage Notifications' })
		).toBeVisible()
		await expect(
			page.getByText(
				'Email notifications are not configured for this environment.'
			)
		).toBeVisible()
	})
})
