import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'

// Drizzle chain mocks — each method returns the next in the chain.
const mockReturning = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockDeleteWhere = vi.fn()
const mockSelectLimit = vi.fn()
const mockSelectWhere = vi.fn()
const mockSelectFrom = vi.fn()
const mockSelect = vi.fn()

vi.mock('../src/data/db', () => ({
	db: {
		update: vi.fn(() => ({ set: mockUpdateSet })),
		delete: vi.fn(() => ({ where: mockDeleteWhere })),
		select: (...args: unknown[]) => {
			mockSelect(...args)
			return { from: mockSelectFrom }
		},
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
	deleteListingById,
	getAvailableListings,
	getListingById,
	getPublicListingById,
	updateListingStatus,
} = await import('../src/data/queries')

// Wire up the full chain before each test.
function wireUpdateChain(returnedRows: Array<{ id: number }>) {
	mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
	mockUpdateWhere.mockReturnValue({ returning: mockReturning })
	mockReturning.mockResolvedValue(returnedRows)
}

function wireDeleteChain() {
	mockDeleteWhere.mockResolvedValue(undefined)
}

function wireSelectChain(returnedRows: unknown[]) {
	mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
	mockSelectLimit.mockResolvedValue(returnedRows)
	// orderBy() must be both awaitable (for unlimited queries) and have .limit()
	const orderByResult = Object.assign(Promise.resolve(returnedRows), {
		limit: mockSelectLimit,
	})
	mockSelectWhere.mockReturnValue({
		orderBy: vi.fn().mockReturnValue(orderByResult),
		limit: mockSelectLimit, // for queries that chain .where().limit() directly
	})
}

describe('deleteListingById', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('soft-deletes a listing and removes related inquiries', async () => {
		wireUpdateChain([{ id: 42 }])
		wireDeleteChain()

		const result = await deleteListingById(42, faker.string.uuid())

		expect(result).toBe(true)
		// Should have called update (soft-delete), not delete
		expect(db.update).toHaveBeenCalled()
		// Should clean up inquiries after successful soft-delete
		expect(db.delete).toHaveBeenCalled()
	})

	it('returns false and skips inquiry cleanup when listing not found', async () => {
		wireUpdateChain([])
		wireDeleteChain()

		const result = await deleteListingById(999, faker.string.uuid())

		expect(result).toBe(false)
		// Should NOT clean up inquiries when no listing was soft-deleted
		expect(db.delete).not.toHaveBeenCalled()
	})
})

describe('updateListingStatus', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns true when the listing is updated', async () => {
		wireUpdateChain([{ id: 1 }])

		const result = await updateListingStatus(
			1,
			faker.string.uuid(),
			'unavailable'
		)

		expect(result).toBe(true)
	})

	it('returns false when no matching live listing exists', async () => {
		wireUpdateChain([])

		const result = await updateListingStatus(1, faker.string.uuid(), 'available')

		expect(result).toBe(false)
	})
})

describe('getAvailableListings', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns empty array when no listings exist', async () => {
		wireSelectChain([])

		const result = await getAvailableListings()

		expect(result).toEqual([])
	})
})

describe('getListingById', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns undefined when listing not found', async () => {
		wireSelectChain([])

		const result = await getListingById(999)

		expect(result).toBeUndefined()
	})
})

describe('getPublicListingById', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns undefined when listing not found', async () => {
		wireSelectChain([])

		const result = await getPublicListingById(999)

		expect(result).toBeUndefined()
	})
})
