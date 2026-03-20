import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import type { NotificationSubscription } from '../src/data/schema'

// ============================================================================
// Drizzle chain mocks
// ============================================================================

const mockReturning = vi.fn()
const mockInsertValues = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockDeleteWhere = vi.fn()
const mockSelectFrom = vi.fn()
const mockSelectWhere = vi.fn()
const mockSelectOrderBy = vi.fn()
const mockSelectLimit = vi.fn()

vi.mock('../src/data/db', () => ({
	db: {
		insert: vi.fn(() => ({ values: mockInsertValues })),
		update: vi.fn(() => ({ set: mockUpdateSet })),
		delete: vi.fn(() => ({ where: mockDeleteWhere })),
		select: vi.fn(() => ({ from: mockSelectFrom })),
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
const { db } = await import('../src/data/db')
const {
	createSubscription,
	getUserSubscriptions,
	getSubscriptionById,
	updateSubscription,
	deleteSubscription,
	getSubscriptionsDue,
	markSubscriptionNotified,
} = await import('../src/data/queries')

// ============================================================================
// Helpers
// ============================================================================

function makeSubscription(
	overrides: Partial<NotificationSubscription> = {}
): NotificationSubscription {
	return {
		id: faker.number.int({ min: 1, max: 9999 }),
		userId: faker.string.uuid(),
		throttlePeriod: 'daily',
		produceTypes: null,
		centerH3: '8928308280fffff',
		resolution: 7,
		ringSize: 0,
		locationName: '',
		lastNotifiedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}
}

/** Wires the select chain for queries that end with .where().limit() */
function wireSelectWithLimit(rows: unknown[]) {
	mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
	mockSelectWhere.mockReturnValue({ limit: mockSelectLimit })
	mockSelectLimit.mockResolvedValue(rows)
}

/** Wires the select chain for queries that end with .where().orderBy() */
function wireSelectWithOrderBy(rows: unknown[]) {
	mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
	mockSelectWhere.mockReturnValue({ orderBy: mockSelectOrderBy })
	mockSelectOrderBy.mockResolvedValue(rows)
}

/** Wires the select chain for queries that end with .where() resolving directly (e.g. getSubscriptionsDue) */
function wireSelectWithDirectWhere(rows: unknown[]) {
	mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
	mockSelectWhere.mockResolvedValue(rows)
}

function wireInsertChain(row: NotificationSubscription) {
	mockInsertValues.mockReturnValue({ returning: mockReturning })
	mockReturning.mockResolvedValue([row])
}

function wireUpdateChain(rows: NotificationSubscription[]) {
	mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
	mockUpdateWhere.mockReturnValue({ returning: mockReturning })
	mockReturning.mockResolvedValue(rows)
}

function wireDeleteChain(rows: Array<{ id: number }>) {
	mockDeleteWhere.mockReturnValue({ returning: mockReturning })
	mockReturning.mockResolvedValue(rows)
}

// ============================================================================
// Tests
// ============================================================================

describe('createSubscription', () => {
	beforeEach(() => vi.clearAllMocks())

	it('inserts a record and returns it', async () => {
		const userId = faker.string.uuid()
		const sub = makeSubscription({ userId })
		wireInsertChain(sub)

		const result = await createSubscription({
			userId: sub.userId,
			locationName: sub.locationName,
			throttlePeriod: sub.throttlePeriod,
			produceTypes: sub.produceTypes,
			centerH3: sub.centerH3,
			resolution: sub.resolution,
			ringSize: sub.ringSize,
		})

		expect(db.insert).toHaveBeenCalled()
		expect(result).toEqual(sub)
	})
})

describe('getUserSubscriptions', () => {
	beforeEach(() => vi.clearAllMocks())

	it("returns only the given user's subscriptions", async () => {
		const userId = faker.string.uuid()
		const userSubs = [makeSubscription({ userId }), makeSubscription({ userId })]
		wireSelectWithOrderBy(userSubs)

		const result = await getUserSubscriptions(userId)

		expect(result).toEqual(userSubs)
		expect(db.select).toHaveBeenCalled()
	})

	it('returns an empty array when the user has no subscriptions', async () => {
		wireSelectWithOrderBy([])

		const result = await getUserSubscriptions(faker.string.uuid())

		expect(result).toEqual([])
	})
})

describe('getSubscriptionById', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns the subscription when found', async () => {
		const sub = makeSubscription()
		wireSelectWithLimit([sub])

		const result = await getSubscriptionById(sub.id)

		expect(result).toEqual(sub)
	})

	it('returns undefined when not found', async () => {
		wireSelectWithLimit([])

		const result = await getSubscriptionById(9999)

		expect(result).toBeUndefined()
	})
})

describe('updateSubscription', () => {
	beforeEach(() => vi.clearAllMocks())

	it('updates and returns the record when owner matches', async () => {
		const sub = makeSubscription({ throttlePeriod: 'weekly' })
		wireUpdateChain([sub])

		const result = await updateSubscription(sub.id, sub.userId, {
			throttlePeriod: 'weekly',
		})

		expect(db.update).toHaveBeenCalled()
		expect(result).toEqual(sub)
	})

	it('returns undefined when the subscription does not belong to the user', async () => {
		wireUpdateChain([])

		const result = await updateSubscription(
			42,
			faker.string.uuid(), // wrong user
			{ throttlePeriod: 'hourly' }
		)

		expect(result).toBeUndefined()
	})
})

describe('deleteSubscription', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns true and deletes the owned record', async () => {
		const sub = makeSubscription()
		wireDeleteChain([{ id: sub.id }])

		const result = await deleteSubscription(sub.id, sub.userId)

		expect(db.delete).toHaveBeenCalled()
		expect(result).toBeTruthy()
	})

	it('returns false when the subscription does not belong to the user', async () => {
		wireDeleteChain([])

		const result = await deleteSubscription(42, faker.string.uuid())

		expect(result).toBeFalsy()
	})
})

describe('getSubscriptionsDue', () => {
	beforeEach(() => vi.clearAllMocks())

	it('returns subscriptions that have never been notified', async () => {
		const sub = makeSubscription({
			throttlePeriod: 'daily',
			lastNotifiedAt: null,
		})
		wireSelectWithDirectWhere([sub])

		const result = await getSubscriptionsDue('daily')

		expect(result).toEqual([sub])
	})

	it('returns subscriptions past their throttle window', async () => {
		const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
		const sub = makeSubscription({
			throttlePeriod: 'hourly',
			lastNotifiedAt: twoHoursAgo,
		})
		wireSelectWithDirectWhere([sub])

		const result = await getSubscriptionsDue('hourly')

		expect(result).toEqual([sub])
		expect(db.select).toHaveBeenCalled()
	})

	it('returns an empty array when no subscriptions are due', async () => {
		wireSelectWithDirectWhere([])

		const result = await getSubscriptionsDue('weekly')

		expect(result).toEqual([])
	})
})

describe('markSubscriptionNotified', () => {
	beforeEach(() => vi.clearAllMocks())

	it('updates lastNotifiedAt and updatedAt on the subscription', async () => {
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
		mockUpdateWhere.mockResolvedValue(undefined)

		const notifiedAt = new Date()
		await markSubscriptionNotified(7, notifiedAt)

		expect(db.update).toHaveBeenCalled()
		expect(mockUpdateSet).toHaveBeenCalledWith(
			expect.objectContaining({
				lastNotifiedAt: notifiedAt,
				updatedAt: notifiedAt,
			})
		)
	})
})
