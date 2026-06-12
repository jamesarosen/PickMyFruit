import { test, expect } from './helpers/fixtures'
import { createTestListing } from './helpers/test-db'

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

test.describe('Home page type filter', () => {
	test.describe.configure({ mode: 'serial' })

	test('type param shows only matching listings and chips toggle it', async ({
		page,
		testUser,
		testListing: figListing,
	}) => {
		const appleListing = await createTestListing(testUser.id, {
			type: 'apple',
			variety: 'Gravenstein',
		})
		const figCard = page.locator(`a[href="/listings/${figListing.id}"]`)
		const appleCard = page.locator(`a[href="/listings/${appleListing.id}"]`)

		await page.goto('/?type=fig')
		await expect(figCard).toBeVisible()
		await expect(appleCard).not.toBeVisible()

		// Chips: switch the filter to apples
		const chips = page.getByRole('group', { name: 'Filter by produce type' })
		await chips.getByRole('link', { name: 'Apples' }).click()
		await expect(page).toHaveURL(/\?type=apple$/)
		await expect(appleCard).toBeVisible()
		await expect(figCard).not.toBeVisible()

		// "All" clears the filter
		await chips.getByRole('link', { name: 'All' }).click()
		await expect(figCard).toBeVisible()
		await expect(appleCard).toBeVisible()
	})

	test('invalid type param is ignored', async ({ page, testListing }) => {
		await page.goto('/?type=not-a-real-type')
		const card = page.locator(`a[href="/listings/${testListing.id}"]`)
		await expect(card).toBeVisible()
	})

	test('type and area filters combine', async ({
		page,
		testUser,
		testListing: figListing,
	}) => {
		const appleListing = await createTestListing(testUser.id, {
			type: 'apple',
		})

		// Area containing both listings + type=apple → only the apple listing
		await page.goto('/?area=872830053ffffff&type=apple')
		await expect(
			page.locator(`a[href="/listings/${appleListing.id}"]`)
		).toBeVisible()
		await expect(
			page.locator(`a[href="/listings/${figListing.id}"]`)
		).not.toBeVisible()

		// Matching area but no apples there → filter-combination empty state
		await page.goto('/?area=872816903ffffff&type=apple')
		await expect(page.getByText('No listings match your filters.')).toBeVisible()
	})
})
