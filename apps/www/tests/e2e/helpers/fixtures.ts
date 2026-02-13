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
	// Auto-fixture: clears cookies before every test
	context: async ({ context }, playwrightUse) => {
		await context.clearCookies()
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
