import { test, expect } from './helpers/fixtures'
import {
	createTestListing,
	createTestUser,
	cleanupTestUser,
	getAddressRevealsForListing,
} from './helpers/test-db'
import { loginViaUI } from './helpers/login'

test.describe('Address Release Policy', () => {
	test.describe.configure({ mode: 'serial' })

	test('verified non-owner reveals the precise address on an on_verified_request listing and the reveal is recorded', async ({
		page,
		testUser: gleaner,
	}) => {
		// Anonymous load → magic-link login → revisit → click reveal is a long
		// flow; triple the timeout so it stays green under realistic dev-server
		// warm-up latency on slow CI hosts.
		test.slow()

		const owner = await createTestUser()
		const listing = await createTestListing(owner.id, {
			address: '900 Pickfair Way',
			city: 'Napa',
			state: 'CA',
			zip: '94559',
			addressReleasePolicy: 'on_verified_request',
		})

		try {
			// Anonymous: visit the listing — the precise street address is not shown,
			// and the reveal CTA renders the unauthenticated copy.
			await page.goto(`/listings/${listing.id}`)
			await expect(
				page.getByText(`${listing.city}, ${listing.state}`)
			).toBeVisible()
			await expect(page.getByText('900 Pickfair Way')).not.toBeVisible()
			await expect(
				page.getByTestId('address-reveal').getByRole('button', {
					name: /sign in to reveal/i,
				})
			).toBeVisible()

			// The owner-approval inquiry form should not appear on auto-release
			// listings — the address path replaces the inquiry path entirely.
			await expect(
				page.getByRole('heading', { name: 'Interested in this produce?' })
			).toHaveCount(0)

			// Pre-condition: no reveal rows yet.
			expect(await getAddressRevealsForListing(listing.id)).toHaveLength(0)

			// Sign in as a verified gleaner (test fixture creates users with emailVerified=true).
			await loginViaUI(page, gleaner)
			await page.goto(`/listings/${listing.id}`)
			await page.waitForLoadState('networkidle', { timeout: 60_000 })

			// Now the button reveals the address synchronously.
			await page
				.getByTestId('address-reveal')
				.getByRole('button', { name: /show street address/i })
				.click()
			await expect(page.getByTestId('revealed-address')).toContainText(
				'900 Pickfair Way',
				{ timeout: 10_000 }
			)
			await expect(page.getByTestId('revealed-address')).toContainText(
				'Napa, CA 94559'
			)

			// After reveal, the map switches from a fuzzed hexagon to an exact pin.
			await expect(
				page.getByRole('img', { name: 'Map showing exact listing location' })
			).toBeVisible({ timeout: 10_000 })

			// Reveal row was appended.
			const reveals = await getAddressRevealsForListing(listing.id)
			expect(reveals).toHaveLength(1)
			expect(reveals[0].userId).toBe(gleaner.id)
		} finally {
			await cleanupTestUser(owner)
		}
	})

	test('on_owner_approval listings (the default) do not expose a reveal CTA', async ({
		page,
		testUser,
	}) => {
		// The default policy keeps the existing inquiry flow in charge — there
		// must be no "Show street address" affordance for non-owners.
		const listing = await createTestListing(testUser.id)

		const otherUser = await createTestUser()
		try {
			await loginViaUI(page, otherUser)
			await page.goto(`/listings/${listing.id}`)
			await page.waitForLoadState('networkidle', { timeout: 60_000 })

			await expect(page.getByTestId('address-reveal')).toHaveCount(0)
		} finally {
			await cleanupTestUser(otherUser)
		}
	})
})
