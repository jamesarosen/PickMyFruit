import { test, expect } from './helpers/fixtures'
import { loginViaUI } from './helpers/login'

test.describe('Notifications', () => {
	test.describe.configure({ mode: 'serial' })

	test('authenticated user can create a subscription and see it in the list', async ({
		page,
		testUser,
	}) => {
		await loginViaUI(page, testUser)

		await page.goto('/notifications/new')
		await expect(
			page.getByRole('heading', { name: 'Create a notification subscription' })
		).toBeVisible()

		const addressInput = page.getByLabel('Address')
		await addressInput.fill('Napa, CA 94558')
		await page.getByRole('button', { name: 'Search' }).click()

		await expect(page.getByText(/Searching within ~3 miles of/i)).toBeVisible()

		await page.getByRole('button', { name: 'Create subscription' }).click()

		await expect(page).toHaveURL('/notifications')
		await expect(
			page.getByRole('heading', { name: 'Notifications' })
		).toBeVisible()
		await expect(page.getByText('Immediately')).toBeVisible()
		await expect(
			page.getByRole('heading', { name: /Napa, Napa County, California/i })
		).toBeVisible()
	})
})
