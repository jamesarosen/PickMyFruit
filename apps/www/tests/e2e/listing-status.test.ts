import { test, expect } from './helpers/fixtures'
import { createTestListing } from './helpers/test-db'
import { loginViaUI } from './helpers/login'

test.describe('Listing Status', () => {
	test.describe.configure({ mode: 'serial' })

	test('owner can toggle listing status from available to unavailable', async ({
		page,
		testUser,
		testListing,
	}) => {
		await loginViaUI(page, testUser)

		// Verify listing card shows available status
		const card = page.locator('article.listing-card')
		await expect(card.locator('.status-badge')).toHaveText('available')

		// Click toggle button
		const toggleButton = card.getByRole('button', { name: 'Mark Unavailable' })
		await expect(toggleButton).toBeVisible()

		const patchPromise = page.waitForResponse(
			(resp) =>
				resp.url().includes(`/api/listings/${testListing.id}`) &&
				resp.request().method() === 'PATCH'
		)
		await toggleButton.click()
		await patchPromise

		// Status badge should now say unavailable
		await expect(card.locator('.status-badge')).toHaveText('unavailable')
		// Button should now say Mark Available
		await expect(
			card.getByRole('button', { name: 'Mark Available' })
		).toBeVisible()
	})

	test('owner can toggle listing status back to available', async ({
		page,
		testUser,
	}) => {
		// Create a listing that starts as unavailable
		const listing = await createTestListing(testUser.id, {
			status: 'unavailable',
		})

		await loginViaUI(page, testUser)

		// Find the card for the unavailable listing
		const cards = page.locator('article.listing-card')
		const unavailableCard = cards.filter({
			has: page.locator('.status-badge', { hasText: 'unavailable' }),
		})
		await expect(unavailableCard).toBeVisible()

		const toggleButton = unavailableCard.getByRole('button', {
			name: 'Mark Available',
		})

		const patchPromise = page.waitForResponse(
			(resp) =>
				resp.url().includes(`/api/listings/${listing.id}`) &&
				resp.request().method() === 'PATCH'
		)
		await toggleButton.click()
		await patchPromise

		await expect(unavailableCard.locator('.status-badge')).toHaveText('available')
	})

	test('unavailable listing shows unavailable message on detail page', async ({
		page,
		testUser,
	}) => {
		const listing = await createTestListing(testUser.id, {
			status: 'unavailable',
		})

		await page.goto(`/listings/${listing.id}`)

		await expect(
			page.getByText('This listing is currently unavailable')
		).toBeVisible()
		await expect(
			page.getByText('Check back later or browse other available listings.')
		).toBeVisible()
	})
})
