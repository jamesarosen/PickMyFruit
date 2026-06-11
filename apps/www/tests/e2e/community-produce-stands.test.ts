import { test, expect } from './helpers/fixtures'
import {
	createTestListing,
	createTestUser,
	cleanupTestUser,
	generateTestUser,
	getAddressRevealsForListing,
} from './helpers/test-db'
import { loginViaUI } from './helpers/login'

test.describe('Community Produce Stands', () => {
	test.describe.configure({ mode: 'serial' })

	test('a verified member reveals a stand location, sees gated steward name and drop-off guidance, and the reveal is recorded', async ({
		page,
		testUser: gleaner,
	}) => {
		// Anonymous load → login → reveal is a long flow; give it room.
		test.slow()

		// Distinctive steward name so we can assert it is *absent* from the
		// anonymous response and *present* after a verified reveal.
		const owner = await createTestUser({
			...generateTestUser(),
			name: 'Zephyrine Stewardson',
		})
		const stand = await createTestListing(owner.id, {
			name: 'Corner produce stand',
			address: '12 Stand Lane',
			city: 'Napa',
			state: 'CA',
			zip: '94559',
			type: 'produce-stand',
			acceptsDropOffs: true,
			addressReleasePolicy: 'on_verified_request',
		})

		try {
			// Anonymous: the steward name must never reach an unauthorized payload.
			await page.goto(`/listings/${stand.id}`)
			await expect(page.getByText(`${stand.city}, ${stand.state}`)).toBeVisible()
			expect(await page.content()).not.toContain('Zephyrine Stewardson')
			await expect(page.getByTestId('steward-name')).toHaveCount(0)

			// Sign in as a verified gleaner.
			await loginViaUI(page, gleaner)
			await page.goto(`/listings/${stand.id}`)
			await page.waitForLoadState('networkidle', { timeout: 60_000 })

			// The stand offers a single, generic location CTA (no take/drop-off split).
			await page
				.getByTestId('address-reveal')
				.getByRole('button', { name: /show stand location/i })
				.click()

			// Address + gated steward name + drop-off guidance all appear. A
			// drop-off stand surfaces its guidance to everyone who reveals it.
			await expect(page.getByTestId('revealed-address')).toContainText(
				'12 Stand Lane',
				{ timeout: 10_000 }
			)
			await expect(page.getByTestId('steward-name')).toContainText(
				'Maintained by Zephyrine Stewardson'
			)
			await expect(page.getByTestId('dropoff-guidance')).toContainText(
				/raw, whole, uncut/i
			)

			// The reveal is recorded against the gleaner.
			const reveals = await getAddressRevealsForListing(stand.id)
			expect(reveals).toHaveLength(1)
			expect(reveals[0].userId).toBe(gleaner.id)
		} finally {
			await cleanupTestUser(owner)
		}
	})

	test('a stand renders a distinct marker on the browse map', async ({
		page,
	}) => {
		test.slow()
		const owner = await createTestUser()
		await createTestListing(owner.id, {
			name: 'Browse-visible stand',
			type: 'produce-stand',
			acceptsDropOffs: true,
			addressReleasePolicy: 'on_verified_request',
		})

		try {
			await page.goto('/')
			await page.waitForLoadState('networkidle', { timeout: 60_000 })
			await expect(page.locator('.stand-marker').first()).toBeVisible({
				timeout: 15_000,
			})
		} finally {
			await cleanupTestUser(owner)
		}
	})

	test('the owner can toggle drop-offs on a stand; the section is absent for non-stands', async ({
		page,
		testUser: owner,
	}) => {
		test.slow()

		const stand = await createTestListing(owner.id, {
			name: 'Editable stand',
			type: 'produce-stand',
			acceptsDropOffs: false,
		})
		const tree = await createTestListing(owner.id, {
			name: 'Just a fig tree',
			type: 'fig',
		})

		await loginViaUI(page, owner)

		// A non-stand listing has no Stand details section.
		await page.goto(`/listings/${tree.id}`)
		await page.waitForLoadState('networkidle', { timeout: 60_000 })
		await expect(page.getByText('Stand details')).toHaveCount(0)

		// The stand shows the section with an unchecked drop-off toggle.
		await page.goto(`/listings/${stand.id}`)
		await page.waitForLoadState('networkidle', { timeout: 60_000 })
		const toggle = page.getByRole('checkbox', { name: /accept drop-offs/i })
		await expect(toggle).not.toBeChecked()

		// Toggling persists: reload and confirm the saved state survives.
		await toggle.check()
		await page.waitForLoadState('networkidle', { timeout: 60_000 })
		await page.reload()
		await page.waitForLoadState('networkidle', { timeout: 60_000 })
		await expect(
			page.getByRole('checkbox', { name: /accept drop-offs/i })
		).toBeChecked()
	})
})
