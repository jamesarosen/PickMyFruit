import { test, expect } from './helpers/fixtures'
import { getMagicLinkToken } from './helpers/test-db'

test.describe('New Listing', () => {
	test.describe.configure({ mode: 'serial' })

	test('unauthenticated user can create a listing via magic-link (token entry)', async ({
		page,
		testUser,
		nominatimMock,
	}) => {
		// Arrive unauthenticated — cookies cleared by context fixture
		await page.goto('/listings/new')

		// Form is accessible; no redirect to /login
		await expect(
			page.getByRole('heading', { name: 'List Your Fruit Tree' })
		).toBeVisible()

		// Email field is shown for unauthenticated users
		await page.getByLabel(/Your email/i).fill(testUser.email)

		// Open the produce-type combobox and select Avocado.
		// Kobalte opens on pointerdown (not click) for mouse; Playwright's
		// locator.click() dispatches the full pointer sequence including pointerdown.
		await page.locator('.combobox__trigger').click()
		await page.locator('.combobox__item').filter({ hasText: 'Avocado' }).click()

		// Other required fields (City and State default to 'Napa' / 'CA')
		await page.getByLabel(/When to Pick/i).fill('July–September')
		await page.getByLabel(/Street Address/i).fill('400 School St')

		// Submit — should trigger magic-link request, not show "Authentication required"
		const magicLinkResponse = page.waitForResponse((resp) =>
			resp.url().includes('/api/auth/sign-in/magic-link')
		)
		await page.getByRole('button', { name: 'Share my produce' }).click()
		await magicLinkResponse

		// The form must geocode before triggering magic-link auth — guards
		// against a regression where the request bypasses Nominatim entirely.
		expect(await nominatimMock.callCount()).toBeGreaterThan(0)

		// Magic-link waiting UI
		await expect(
			page.getByRole('heading', { name: 'Check your email' })
		).toBeVisible({ timeout: 10_000 })
		await expect(page.getByText(testUser.email)).toBeVisible()

		// Verify token inline (simulates user entering token from email)
		const token = await getMagicLinkToken(testUser.email)
		await page
			.locator('input#magic-link-token')
			.pressSequentially(token, { delay: 20 })
		await page.getByRole('button', { name: 'Verify' }).click()

		// Listing created — navigated to detail page
		await expect(page).toHaveURL(/\/listings\/\d+/, { timeout: 10_000 })
	})
})
