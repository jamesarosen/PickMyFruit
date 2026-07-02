import { test, expect } from './helpers/fixtures'
import {
	createTestListing,
	createTestUser,
	cleanupTestUser,
} from './helpers/test-db'

test.describe('Home page — welcomes growers, pickers, and both', () => {
	test('the hero offers a path for growers and a path for pickers', async ({
		page,
	}) => {
		await page.goto('/')

		const growerCta = page.getByRole('link', { name: "Share What I'm Growing" })
		await expect(growerCta).toBeVisible()
		await expect(growerCta).toHaveAttribute('href', '/listings/new')

		const pickerCta = page.getByRole('link', { name: 'Find Fruit to Pick' })
		await expect(pickerCta).toBeVisible()
		await expect(pickerCta).toHaveAttribute('href', '#available-listings')
	})

	test('the picker hero CTA jumps to the available listings', async ({
		page,
	}) => {
		const owner = await createTestUser()
		await createTestListing(owner.id, { name: 'Backyard lemons' })

		try {
			await page.goto('/')
			await page.getByRole('link', { name: 'Find Fruit to Pick' }).click()

			await expect(page.locator('#available-listings')).toBeInViewport()
			await expect(
				page.getByRole('heading', { name: 'Available Now' })
			).toBeVisible()
		} finally {
			await cleanupTestUser(owner)
		}
	})

	test('How It Works explains the grower path, the picker path, and doing both', async ({
		page,
	}) => {
		await page.goto('/')

		await expect(
			page.getByRole('heading', { name: 'Got more fruit than you can use?' })
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'No garden? No problem.' })
		).toBeVisible()

		// Grower-pickers are told explicitly that both roles are welcome.
		await expect(page.getByText(/do both/i)).toBeVisible()

		// Each path ends in its own next step.
		await expect(
			page.getByRole('link', { name: 'Add a Listing' })
		).toHaveAttribute('href', '/listings/new')
		await expect(
			page.getByRole('link', { name: "Browse What's Ripe" })
		).toHaveAttribute('href', '#available-listings')
	})

	test('the sign-in page speaks to pickers as well as growers', async ({
		page,
	}) => {
		await page.goto('/login')

		await expect(page.getByText(/ask to pick/i)).toBeVisible()
	})
})
