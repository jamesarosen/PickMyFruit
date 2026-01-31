import { test as base } from '@playwright/test'
import { type TestUser, createTestUser, cleanupTestUser } from './test-db'

type TestFixtures = {
	testUser: TestUser
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
})

export { expect } from '@playwright/test'
