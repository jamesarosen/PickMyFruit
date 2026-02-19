import { test, expect } from './helpers/fixtures'
import {
	createTestUser,
	cleanupTestUser,
	createTestListing,
	getInquiriesForListing,
} from './helpers/test-db'
import { loginViaUI } from './helpers/login'

test.describe('Inquiry Flow', () => {
	test.describe.configure({ mode: 'serial' })

	test('authenticated user can submit an inquiry', async ({
		page,
		testUser: gleaner,
	}) => {
		// Create a separate owner with a listing
		const owner = await createTestUser()
		const listing = await createTestListing(owner.id)

		try {
			await loginViaUI(page, gleaner)
			await page.goto(`/listings/${listing.id}`)

			// Verify the inquiry form is visible
			await expect(
				page.getByRole('heading', { name: 'Interested in this fruit?' })
			).toBeVisible()

			// Fill in the note and submit
			const noteText = 'I would love some figs!'
			const noteField = page.locator('#inquiry-note')
			await noteField.click()
			await noteField.pressSequentially(noteText, { delay: 20 })
			await expect(noteField).toHaveValue(noteText)
			await page.getByRole('button', { name: 'Put me in touch' }).click()

			// Verify success message
			await expect(
				page.getByRole('heading', { name: 'Request sent!' })
			).toBeVisible()
			await expect(page.getByText('The owner has been notified')).toBeVisible()

			// Verify inquiry was recorded in the database
			const rows = await getInquiriesForListing(listing.id)
			expect(rows).toHaveLength(1)
			expect(rows[0].gleanerId).toBe(gleaner.id)
			expect(rows[0].note).toBe(noteText)
		} finally {
			await cleanupTestUser(owner)
		}
	})

	test('rate-limits duplicate inquiry within 24 hours', async ({
		page,
		testUser: gleaner,
	}) => {
		const owner = await createTestUser()
		const listing = await createTestListing(owner.id)

		try {
			await loginViaUI(page, gleaner)
			await page.goto(`/listings/${listing.id}`)

			// Wait for hydration before interacting with the form
			await page.waitForLoadState('networkidle')

			// First inquiry succeeds
			await page.getByRole('button', { name: 'Put me in touch' }).click()
			await expect(
				page.getByRole('heading', { name: 'Request sent!' })
			).toBeVisible()

			// Reload to get a fresh form
			await page.goto(`/listings/${listing.id}`)
			await page.waitForLoadState('networkidle')

			// Second inquiry shows rate-limit message
			await page.getByRole('button', { name: 'Put me in touch' }).click()
			await expect(
				page.getByRole('heading', { name: 'Already contacted' })
			).toBeVisible()
			await expect(page.getByText('wait 24 hours')).toBeVisible()
		} finally {
			await cleanupTestUser(owner)
		}
	})

	test('owner cannot see inquiry form on own listing', async ({
		page,
		testUser,
		testListing,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto(`/listings/${testListing.id}`)

		// Owner sees "This is your listing" instead of the inquiry form
		await expect(page.getByText('This is your listing.')).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Interested in this fruit?' })
		).not.toBeVisible()
	})

	test('inquiry form is hidden on unavailable listings', async ({
		page,
		testUser,
	}) => {
		const listing = await createTestListing(testUser.id, {
			status: 'unavailable',
		})

		// View as unauthenticated user
		await page.goto(`/listings/${listing.id}`)

		await expect(
			page.getByText('This listing is currently unavailable')
		).toBeVisible()
		await expect(
			page.getByRole('heading', { name: 'Interested in this fruit?' })
		).not.toBeVisible()
	})
})
