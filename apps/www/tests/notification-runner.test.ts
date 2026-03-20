// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { latLngToCell } from 'h3-js'
import { useTestDb } from './helpers/test-db-connection'
import { listings, notificationSubscriptions, user } from '../src/data/schema'

// ============================================================================
// Real DB wired via lazy getter — must come before the module-under-test import
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let testDb: any = null

vi.mock('../src/data/db', () => ({
	get db() {
		return testDb
	},
}))

vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		captureException: vi.fn(),
		startSpan: vi.fn((_, fn: (span: { setAttribute: () => void }) => unknown) =>
			fn({ setAttribute: vi.fn() })
		),
	},
}))

// Must import after mocking
const { runForThrottlePeriod } = await import('../src/lib/notification-runner')

// ============================================================================
// Test DB lifecycle
// ============================================================================

const { getDb } = useTestDb()

beforeEach(async () => {
	testDb = await getDb()
})

// ============================================================================
// Seed helpers
// ============================================================================

const BASE_URL = 'http://localhost:5174'
const SUB_LAT = 38.2966234
const SUB_LNG = -122.2893688
const RESOLUTION = 7

async function seedUser() {
	const id = faker.string.uuid()
	await testDb.insert(user).values({
		id,
		name: faker.person.fullName(),
		email: `runner-test-${id}@test.local`,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	})
	return id
}

async function seedSubscription(userId: string, overrides = {}) {
	const [row] = await testDb
		.insert(notificationSubscriptions)
		.values({
			userId,
			locationName: 'Test area',
			throttlePeriod: 'daily',
			produceTypes: null,
			centerH3: latLngToCell(SUB_LAT, SUB_LNG, RESOLUTION),
			resolution: RESOLUTION,
			ringSize: 0,
			createdAt: new Date(),
			updatedAt: new Date(),
			...overrides,
		})
		.returning()
	return row
}

/** Seeds a listing at the same lat/lng as the default subscription center — guaranteed H3 match. */
async function seedMatchingListing(userId: string, overrides = {}) {
	const [row] = await testDb
		.insert(listings)
		.values({
			name: 'Test fig tree',
			type: 'fig',
			variety: 'Brown Turkey',
			status: 'available',
			quantity: 'moderate',
			harvestWindow: 'July-September',
			address: '1 Test St',
			city: 'Napa',
			state: 'CA',
			zip: '94558',
			lat: SUB_LAT,
			lng: SUB_LNG,
			h3Index: latLngToCell(SUB_LAT, SUB_LNG, 13),
			userId,
			notes: null,
			accessInstructions: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			...overrides,
		})
		.returning()
	return row
}

// ============================================================================
// Tests
// ============================================================================

describe('runForThrottlePeriod', () => {
	it('skips subscriptions with no matching listings', async () => {
		const userId = await seedUser()
		await seedSubscription(userId, { throttlePeriod: 'daily' })
		// No listings seeded → nothing to match

		const sendEmail = vi.fn()
		await runForThrottlePeriod('daily', BASE_URL, sendEmail)

		expect(sendEmail).not.toHaveBeenCalled()
	})

	it('sends email with matching listings and marks subscription notified', async () => {
		const userId = await seedUser()
		const sub = await seedSubscription(userId, { throttlePeriod: 'daily' })
		await seedMatchingListing(userId)

		const sendEmail = vi.fn().mockResolvedValue(undefined)
		await runForThrottlePeriod('daily', BASE_URL, sendEmail)

		expect(sendEmail).toHaveBeenCalledOnce()
		const call = sendEmail.mock.calls[0][0]
		expect(call.subscriptionId).toBe(sub.id)
		expect(call.baseUrl).toBe(BASE_URL)
		expect(call.listings).toHaveLength(1)
		expect(call.listings[0].type).toBe('fig')

		// Verify DB was updated
		const [updated] = await testDb
			.select({ lastNotifiedAt: notificationSubscriptions.lastNotifiedAt })
			.from(notificationSubscriptions)
			.where(
				(await import('drizzle-orm')).eq(notificationSubscriptions.id, sub.id)
			)
		expect(updated.lastNotifiedAt).not.toBeNull()
	})

	it('processes other subscriptions when one throws', async () => {
		const userId = await seedUser()
		const sub1 = await seedSubscription(userId, { throttlePeriod: 'daily' })
		await seedSubscription(userId, { throttlePeriod: 'daily' })
		await seedMatchingListing(userId)

		let callCount = 0
		const sendEmail = vi.fn().mockImplementation(({ subscriptionId }) => {
			callCount++
			// Fail on first call, succeed on second
			if (subscriptionId === sub1.id && callCount === 1) {
				return Promise.reject(new Error('email send failed'))
			}
			return Promise.resolve()
		})

		await runForThrottlePeriod('daily', BASE_URL, sendEmail)

		// Both subscriptions attempted; one succeeded despite the other failing
		expect(sendEmail).toHaveBeenCalledTimes(2)
		const { Sentry } = await import('../src/lib/sentry')
		expect(Sentry.captureException).toHaveBeenCalledOnce()
	})

	it('does not send for subscriptions on a different throttle period', async () => {
		const userId = await seedUser()
		await seedSubscription(userId, { throttlePeriod: 'weekly' })
		await seedMatchingListing(userId)

		const sendEmail = vi.fn()
		await runForThrottlePeriod('daily', BASE_URL, sendEmail)

		expect(sendEmail).not.toHaveBeenCalled()
	})
})
