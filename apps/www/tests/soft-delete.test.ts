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

vi.mock('../src/lib/storage.server', () => ({
	storage: { publicUrl: (path: string) => `https://cdn.example.com/${path}` },
}))

// deleteListingById runs inside db.transaction; the callback receives a tx
// object exposing the same chain mocks so assertions can distinguish
// transactional writes from direct ones.
const mockTxUpdate = vi.fn(() => ({ set: mockUpdateSet }))
const mockTxDelete = vi.fn(() => ({ where: mockDeleteWhere }))

vi.mock('../src/data/db.server', () => ({
	db: {
		update: vi.fn(() => ({ set: mockUpdateSet })),
		delete: vi.fn(() => ({ where: mockDeleteWhere })),
		transaction: vi.fn((fn: (tx: unknown) => unknown) =>
			fn({ update: mockTxUpdate, delete: mockTxDelete })
		),
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
const {
	deleteListingById,
	getAvailableListings,
	getListingById,
	getPublicListingById,
	updateListingById,
} = await import('../src/data/queries.server')

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
	// fetchPhotosByListingIds awaits .orderBy() directly; getAvailableListings chains .limit().
	// Attach .limit() to a resolved Promise so both callers work from the same mock object.
	const orderByResult = Object.assign(Promise.resolve([]), {
		limit: mockSelectLimit,
	})
	mockSelectWhere.mockReturnValue({
		orderBy: vi.fn().mockReturnValue(orderByResult),
		limit: mockSelectLimit,
	})
	mockSelectLimit.mockResolvedValue(returnedRows)
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
		expect(mockTxUpdate).toHaveBeenCalled()
		// Should clean up inquiries after successful soft-delete
		expect(mockTxDelete).toHaveBeenCalled()
	})

	it('returns false and skips inquiry cleanup when listing not found', async () => {
		wireUpdateChain([])
		wireDeleteChain()

		const result = await deleteListingById(999, faker.string.uuid())

		expect(result).toBe(false)
		// Should NOT clean up inquiries when no listing was soft-deleted
		expect(mockTxDelete).not.toHaveBeenCalled()
	})
})

describe('updateListingById', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns { tag: updated } when the optimistic lock matches', async () => {
		const listing = { id: 1, name: 'Apple Tree', status: 'available' }
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
		mockUpdateWhere.mockReturnValue({ returning: mockReturning })
		mockReturning.mockResolvedValue([listing])

		const result = await updateListingById(1, faker.string.uuid(), 1700000000, {
			name: 'Apple Tree Updated',
		})

		expect(result).toEqual({ tag: 'updated', listing })
	})

	it('returns { tag: conflict } when UPDATE matches no row but the listing exists', async () => {
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
		mockUpdateWhere.mockReturnValue({ returning: mockReturning })
		mockReturning.mockResolvedValue([])
		wireSelectChain([{ id: 1 }])

		const result = await updateListingById(1, faker.string.uuid(), 1700000000, {
			name: 'Stale Edit',
		})

		expect(result).toEqual({ tag: 'conflict' })
	})

	it('returns { tag: not_found } when no matching listing exists for this owner', async () => {
		mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
		mockUpdateWhere.mockReturnValue({ returning: mockReturning })
		mockReturning.mockResolvedValue([])
		wireSelectChain([])

		const result = await updateListingById(999, faker.string.uuid(), 1700000000, {
			status: 'unavailable',
		})

		expect(result).toEqual({ tag: 'not_found' })
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
