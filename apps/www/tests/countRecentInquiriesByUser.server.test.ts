import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'

const mockSelect = vi.fn()
const mockFrom = vi.fn()
const mockWhere = vi.fn()

vi.mock('../src/data/db.server', () => ({
	db: {
		select: (...args: unknown[]) => {
			mockSelect(...args)
			return { from: mockFrom }
		},
	},
}))

vi.mock('../src/lib/storage.server', () => ({
	storage: { publicUrl: (path: string) => `https://cdn.example.com/${path}` },
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
const { countRecentInquiriesByUser } =
	await import('../src/data/queries.server')

describe('countRecentInquiriesByUser', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockFrom.mockReturnValue({ where: mockWhere })
	})

	it('returns the count of recent inquiries', async () => {
		mockWhere.mockResolvedValue([{ count: 7 }])

		const result = await countRecentInquiriesByUser(faker.string.uuid())

		expect(result).toBe(7)
	})

	it('returns 0 when the query produces no row', async () => {
		mockWhere.mockResolvedValue([])

		const result = await countRecentInquiriesByUser(faker.string.uuid())

		expect(result).toBe(0)
	})
})
