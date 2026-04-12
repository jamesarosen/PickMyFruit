import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSelect = vi.fn()

let listingRows: Array<Record<string, unknown>> = []
let photoRows: Array<{
	id: string
	listingId: number
	ext: string
	order: number
}> = []
let selectInvocationCount = 0

vi.mock('../src/lib/storage.server', () => ({
	storage: {
		publicUrl: (path: string) => `https://cdn.example.com/${path}`,
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

vi.mock('../src/data/db.server', () => ({
	db: {
		select: (...args: unknown[]) => mockSelect(...args),
	},
}))

vi.mock('drizzle-orm', async () => {
	const actual =
		await vi.importActual<typeof import('drizzle-orm')>('drizzle-orm')
	return {
		...actual,
		inArray: vi.fn((_: unknown, values: number[]) => ({
			kind: 'inArray',
			values,
		})),
	}
})

const { getUserListings } = await import('../src/data/queries.server')

function makeListingRow(id: number) {
	return {
		id,
		name: `Listing ${id}`,
		type: 'apple',
		variety: null,
		status: 'available',
		quantity: 'some',
		harvestWindow: null,
		address: null,
		city: 'Napa',
		state: 'CA',
		zip: null,
		lat: 0,
		lng: 0,
		h3Index: '8928308280fffff',
		userId: 'owner-1',
		notes: null,
		accessInstructions: null,
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	}
}

describe('getUserListings photo fetch limit guard', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		selectInvocationCount = 0

		mockSelect.mockImplementation(() => {
			selectInvocationCount += 1

			if (selectInvocationCount === 1) {
				return {
					from: () => ({
						where: () => ({
							orderBy: () => Promise.resolve(listingRows),
						}),
					}),
				}
			}

			return {
				from: () => ({
					where: (whereExpression: { kind?: string; values?: number[] }) => ({
						orderBy: () => {
							const requestedIds =
								whereExpression.kind === 'inArray' ? (whereExpression.values ?? []) : []
							return Promise.resolve(
								photoRows.filter((row) => requestedIds.includes(row.listingId))
							)
						},
					}),
				}),
			}
		})
	})

	it('throws when photo lookup is asked to handle more than 100 listing IDs', async () => {
		listingRows = Array.from({ length: 101 }, (_, index) =>
			makeListingRow(index + 1)
		)
		photoRows = [{ id: 'photo-101', listingId: 101, ext: '.jpg', order: 0 }]

		await expect(getUserListings('owner-1')).rejects.toThrow(
			/fetchPhotosByListingIds: expected at most 100 listing IDs, received 101/
		)
	})
})
