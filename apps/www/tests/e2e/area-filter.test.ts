import { test, expect } from './helpers/fixtures'

test.describe('Home page area filter', () => {
	test.describe.configure({ mode: 'serial' })

	test('resolution-7 area shows matching listings', async ({
		page,
		testListing,
	}) => {
		// 872830053ffffff is the resolution-7 parent of the test listing at 38.3, -122.3
		await page.goto('/?area=872830053ffffff')
		const card = page.locator(`a[href="/listings/${testListing.id}"]`)
		await expect(card).toBeVisible()
	})

	test('coarser area (resolution 6) includes descendant listings', async ({
		page,
		testListing,
	}) => {
		// 862830057ffffff is the resolution-6 parent
		await page.goto('/?area=862830057ffffff')
		const card = page.locator(`a[href="/listings/${testListing.id}"]`)
		await expect(card).toBeVisible()
	})

	test('resolution 8 area matches listings', async ({ page, testListing }) => {
		// 8828300531fffff is resolution 8 (MAX_PUBLIC_AREA) — passes through unchanged
		await page.goto('/?area=8828300531fffff')
		const card = page.locator(`a[href="/listings/${testListing.id}"]`)
		await expect(card).toBeVisible()
	})

	test('unrelated area shows no listings', async ({ page, testListing: _ }) => {
		// A valid resolution-7 cell far from Napa (near Susanville, CA)
		await page.goto('/?area=872816903ffffff')
		await expect(page.getByText('No listings in this area.')).toBeVisible()
	})

	test('invalid area param is ignored and shows all listings', async ({
		page,
		testListing,
	}) => {
		await page.goto('/?area=not-a-valid-cell')
		const card = page.locator(`a[href="/listings/${testListing.id}"]`)
		await expect(card).toBeVisible()
		// No filter UI should be shown
		await expect(page.getByText('Show all listings')).not.toBeVisible()
	})
})
