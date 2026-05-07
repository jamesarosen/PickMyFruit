import { test as base } from '@playwright/test'
import {
	type TestUser,
	type TestListing,
	createTestUser,
	cleanupTestUser,
	createTestListing,
} from './test-db'

type TestFixtures = {
	testUser: TestUser
	testListing: TestListing
}

export const test = base.extend<TestFixtures>({
	// Auto-fixture: clears cookies before every test and mocks geocoding
	context: async ({ context }, playwrightUse) => {
		await context.clearCookies()
		// Mock Nominatim geocoding API to avoid 403 rate limiting in tests
		await context.route('https://nominatim.openstreetmap.org/**', (route) => {
			// Return a mock response for any address
			route.fulfill({
				status: 200,
				body: JSON.stringify([
					{
						lat: '38.2966234',
						lon: '-122.2893688',
						display_name: 'Test Address, Napa, California 94558, United States',
					},
				]),
			})
		})
		await playwrightUse(context)
	},

	testUser: async ({ browserName: _ }, playwrightUse) => {
		const user = await createTestUser()
		await playwrightUse(user)
		await cleanupTestUser(user)
	},

	testListing: async ({ testUser }, playwrightUse) => {
		const listing = await createTestListing(testUser.id)
		await playwrightUse(listing)
		// Cleaned up via cleanupTestUser (deletes all listings for user)
	},
})

export { expect } from '@playwright/test'
