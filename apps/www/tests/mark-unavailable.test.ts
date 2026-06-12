import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'

// Drizzle chain mocks — each method returns the next in the chain.
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()
const mockUpdateReturning = vi.fn()
const mockInsertValues = vi.fn()
const mockInsertConflict = vi.fn()
const mockInsertReturning = vi.fn()
const mockDeleteWhere = vi.fn()

vi.mock('../src/lib/storage.server', () => ({
	storage: { publicUrl: (path: string) => `https://cdn.example.com/${path}` },
}))

vi.mock('../src/data/db.server', () => {
	const mockDb: Record<string, unknown> = {
		update: vi.fn(() => ({ set: mockUpdateSet })),
		insert: vi.fn(() => ({ values: mockInsertValues })),
		delete: vi.fn(() => ({ where: mockDeleteWhere })),
		transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mockDb)),
	}
	return { db: mockDb }
})

vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		captureException: vi.fn(),
		startSpan: vi.fn((_, fn: (span: { setAttribute: () => void }) => unknown) =>
			fn({ setAttribute: vi.fn() })
		),
	},
}))

// Must import after mocking
const { db } = await import('../src/data/db.server')
const { markListingUnavailable } = await import('../src/data/queries.server')

function wireUpdateChain(returnedRows: Array<{ id: number }>) {
	mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })
	mockUpdateWhere.mockReturnValue({ returning: mockUpdateReturning })
	mockUpdateReturning.mockResolvedValue(returnedRows)
}

function wireInsertChain(returnedRows: Array<{ nonce: string }>) {
	mockInsertValues.mockReturnValue({ onConflictDoNothing: mockInsertConflict })
	mockInsertConflict.mockReturnValue({ returning: mockInsertReturning })
	mockInsertReturning.mockResolvedValue(returnedRows)
}

describe('markListingUnavailable', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockDeleteWhere.mockResolvedValue(undefined)
	})

	it('marks the listing and consumes the nonce on first use', async () => {
		const nonce = faker.string.uuid()
		wireUpdateChain([{ id: 42 }])
		wireInsertChain([{ nonce }])

		const result = await markListingUnavailable(42, nonce)

		expect(result).toBe('marked')
		expect(db.update).toHaveBeenCalled()
		expect(mockInsertValues).toHaveBeenCalledWith(
			expect.objectContaining({ nonce, listingId: 42 })
		)
		// Purges nonces older than the signature window
		expect(db.delete).toHaveBeenCalled()
	})

	it('returns already_used and rolls back when the nonce was consumed before', async () => {
		wireUpdateChain([{ id: 42 }])
		wireInsertChain([]) // onConflictDoNothing matched an existing nonce

		const result = await markListingUnavailable(42, faker.string.uuid())

		expect(result).toBe('already_used')
		// The thrown rollback error must abort before the purge runs
		expect(db.delete).not.toHaveBeenCalled()
	})

	it('returns not_found without consuming the nonce when no listing matches', async () => {
		wireUpdateChain([])

		const result = await markListingUnavailable(999, faker.string.uuid())

		expect(result).toBe('not_found')
		expect(mockInsertValues).not.toHaveBeenCalled()
	})
})
