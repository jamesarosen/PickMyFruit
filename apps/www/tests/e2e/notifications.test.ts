import { test, expect } from './helpers/fixtures'
import { loginViaUI } from './helpers/login'
import { createTestSubscription } from './helpers/test-db'

test.describe('Notifications', () => {
	test.describe.configure({ mode: 'serial' })

	test('unauthenticated user is redirected to login', async ({ page }) => {
		await page.goto('/notifications')
		await expect(page).toHaveURL(/\/login/)
	})

	test('authenticated user sees empty state with link to create', async ({
		page,
		testUser,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/notifications')
		await expect(
			page.getByRole('heading', { name: 'My Notifications' })
		).toBeVisible()
		await expect(page.getByText('No subscriptions yet')).toBeVisible()
		await expect(
			page.getByRole('link', { name: 'Add a subscription' })
		).toBeVisible()
	})

	test('authenticated user can navigate to create subscription page', async ({
		page,
		testUser,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto('/notifications')
		await page.getByRole('link', { name: 'Add a subscription' }).click()
		await expect(page).toHaveURL('/notifications/new')
		await expect(
			page.getByRole('heading', { name: 'New Subscription' })
		).toBeVisible()
	})

	test('authenticated user can create a subscription', async ({
		page,
		testUser,
	}) => {
		// Mock Nominatim geocoding
		await page.route('**/nominatim.openstreetmap.org/**', async (route) => {
			await route.fulfill({
				contentType: 'application/json',
				body: JSON.stringify([
					{
						lat: '38.2966234',
						lon: '-122.2893688',
						display_name: 'Napa, Napa County, California, United States',
					},
				]),
			})
		})

		await loginViaUI(page, testUser)
		await page.goto('/notifications/new')

		// Fill in address
		await page.getByLabel(/Address or zip/i).fill('Napa, CA')
		await page.getByRole('button', { name: /Search/i }).click()

		// Wait for geocoding result
		await expect(page.getByText(/Napa, Napa County/i)).toBeVisible({
			timeout: 5000,
		})

		// Select throttle period
		await page.getByRole('button', { name: /Notification frequency/i }).click()
		await page.getByRole('option', { name: 'Daily' }).click()

		// Submit form
		await page.getByRole('button', { name: 'Save subscription' }).click()

		// Redirected to notifications list with new subscription
		await expect(page).toHaveURL('/notifications', { timeout: 5000 })
		await expect(page.getByText('Daily')).toBeVisible()
	})

	test('"Add a subscription" is disabled when user has 10 subscriptions', async ({
		page,
		testUser,
	}) => {
		await Promise.all(
			Array.from({ length: 10 }, () => createTestSubscription(testUser.id))
		)
		await loginViaUI(page, testUser)
		await page.goto('/notifications')
		await page.waitForLoadState('networkidle')
		const addLink = page.getByRole('link', { name: 'Add a subscription' })
		await expect(addLink).toHaveAttribute('aria-disabled', 'true')
	})

	test('user can delete a subscription from the edit page', async ({
		page,
		testUser,
	}) => {
		const sub = await createTestSubscription(testUser.id)
		await loginViaUI(page, testUser)
		await page.goto(`/notifications/${sub.id}/edit`)
		await page.waitForLoadState('networkidle')

		// Click delete, then confirm in the inline confirmation
		await page.getByRole('button', { name: 'Delete subscription' }).click()
		await page.getByRole('button', { name: 'Yes, delete' }).click()

		// Redirected to list; subscription gone
		await expect(page).toHaveURL('/notifications', { timeout: 5000 })
		await expect(page.getByText('No subscriptions yet')).toBeVisible()
	})
})
