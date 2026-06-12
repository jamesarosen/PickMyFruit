import { createHmac, randomUUID } from 'node:crypto'
import { test, expect } from './helpers/fixtures'
import { createTestListing, setListingStatus } from './helpers/test-db'
import { loginViaUI } from './helpers/login'
import { loadTestEnv } from '../helpers/test-env'

// The webServer signs with the same .env.test secret (see playwright.config.ts).
const HMAC_SECRET = loadTestEnv().HMAC_SECRET

test.describe('Listing Status', () => {
	test.describe.configure({ mode: 'serial' })

	test('owner can change listing status from available to unavailable', async ({
		page,
		testUser,
		testListing,
	}) => {
		await loginViaUI(page, testUser)
		await page.goto(`/listings/${testListing.id}`)

		const availableRadio = page.getByRole('radio', { name: /^Available / })
		const unavailableRadio = page.getByRole('radio', { name: /^Unavailable / })

		await expect(availableRadio).toBeVisible({ timeout: 10000 })
		await expect(availableRadio).toBeChecked()
		await expect(unavailableRadio).not.toBeChecked()

		await unavailableRadio.click()
		await expect(unavailableRadio).toBeChecked({ timeout: 10000 })
		await expect(availableRadio).not.toBeChecked()
	})

	test('owner can change listing status back to available', async ({
		page,
		testUser,
	}) => {
		const listing = await createTestListing(testUser.id, {
			status: 'unavailable',
		})

		await loginViaUI(page, testUser)
		await page.goto(`/listings/${listing.id}`)

		const availableRadio = page.getByRole('radio', { name: /^Available / })
		const unavailableRadio = page.getByRole('radio', { name: /^Unavailable / })

		await expect(unavailableRadio).toBeVisible({ timeout: 10000 })
		await expect(unavailableRadio).toBeChecked()

		await availableRadio.click()
		await expect(availableRadio).toBeChecked({ timeout: 10000 })
	})

	test('owner can set listing status to private', async ({ page, testUser }) => {
		const listing = await createTestListing(testUser.id, {
			status: 'available',
		})

		await loginViaUI(page, testUser)
		await page.goto(`/listings/${listing.id}`)

		const privateRadio = page.getByRole('radio', { name: /^Private / })

		await expect(privateRadio).toBeVisible({ timeout: 10000 })
		await expect(privateRadio).not.toBeChecked()

		await privateRadio.click()
		await expect(privateRadio).toBeChecked({ timeout: 10000 })
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

	test('signed unavailable link works once and cannot be replayed', async ({
		page,
		testUser,
	}) => {
		const listing = await createTestListing(testUser.id, {
			status: 'available',
		})
		const url = signedUnavailableUrl(listing.id)

		// First click marks the listing unavailable and redirects to it.
		await page.goto(url)
		await expect(page).toHaveURL(
			new RegExp(`/listings/${listing.id}\\?marked=unavailable$`)
		)
		await expect(
			page.getByText('This listing is currently unavailable')
		).toBeVisible()

		// Grower re-lists; replaying the same link must not flip it back.
		await setListingStatus(listing.id, 'available')
		await page.goto(url)
		await expect(page).toHaveURL(new RegExp(`/listings/${listing.id}$`))
		await expect(
			page.getByText('This listing is currently unavailable')
		).not.toBeVisible()
	})
})

/** Builds a signed one-click URL the same way `buildUnavailableUrl` does on the server. */
function signedUnavailableUrl(listingId: number): string {
	const nonce = randomUUID()
	const ts = Date.now()
	const sig = createHmac('sha256', HMAC_SECRET)
		.update(`${listingId}:${nonce}:${ts}`)
		.digest('hex')
	return `/api/listings/${listingId}/unavailable?nonce=${nonce}&ts=${ts}&sig=${sig}`
}
