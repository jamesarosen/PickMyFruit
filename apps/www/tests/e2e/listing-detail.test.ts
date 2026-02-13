import { test, expect } from './helpers/fixtures'
import { createTestListing } from './helpers/test-db'

test.describe('Listing Detail Page', () => {
	// Run serially to avoid SQLite lock conflicts from parallel DB writes
	test.describe.configure({ mode: 'serial' })

	test('displays listing details when navigated to directly', async ({
		page,
		testListing,
	}) => {
		await page.goto(`/listings/${testListing.id}`)

		// Verify the fruit type appears as heading
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			testListing.type
		)

		// Verify key details are visible
		await expect(page.getByText(testListing.variety!)).toBeVisible()
		await expect(
			page.getByText(`${testListing.city}, ${testListing.state}`)
		).toBeVisible()

		// Verify status badge
		await expect(page.locator('.status-badge')).toHaveText(testListing.status)
	})

	test('shows not-found for non-existent listing', async ({ page }) => {
		await page.goto('/listings/999999')

		await expect(page.getByText('Listing Not Found')).toBeVisible()
		await expect(
			page.getByText("This listing may have been removed or doesn't exist.")
		).toBeVisible()
	})

	test('shows not-found for private listing', async ({ page, testUser }) => {
		const privateListing = await createTestListing(testUser.id, {
			status: 'private',
		})
		await page.goto(`/listings/${privateListing.id}`)

		await expect(page.getByText('Listing Not Found')).toBeVisible()
	})

	test('homepage listing card links to detail page', async ({
		page,
		testListing,
	}) => {
		await page.goto('/')

		// testListing is the only listing in the clean test DB, so it's always shown
		const card = page.locator(`a[href="/listings/${testListing.id}"]`)
		await expect(card).toBeVisible()
		await card.click()
		await expect(page).toHaveURL(`/listings/${testListing.id}`)
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			testListing.type
		)
	})

	test('breadcrumb links back to home', async ({ page, testListing }) => {
		await page.goto(`/listings/${testListing.id}`)

		const homeLink = page.locator('.breadcrumb a', { hasText: 'Home' })
		await expect(homeLink).toBeVisible()
		await homeLink.click()
		await expect(page).toHaveURL('/')
	})
})
