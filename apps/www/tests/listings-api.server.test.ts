import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnerListingView } from '../src/data/listing'

const mockGetSession = vi.fn()
const mockGetUserListings = vi.fn()
const mockCaptureMessage = vi.fn()

vi.mock('../src/lib/auth.server', () => ({
	auth: {
		api: {
			getSession: mockGetSession,
		},
	},
}))

vi.mock('../src/data/queries.server', () => ({
	getUserListings: (...args: unknown[]) => mockGetUserListings(...args),
}))

vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
	},
}))

const { getMyListings } = await import('../src/api/listings')

function makeListing(id: number): OwnerListingView {
	return {
		id,
		name: `Listing ${id}`,
		type: 'apple',
		variety: null,
		status: 'available',
		quantity: 'some',
		harvestWindow: null,
		address: `123${id} Main St`,
		city: 'Napa',
		state: 'CA',
		zip: null,
		lat: 0,
		lng: 0,
		h3Index: '8928308280fffff',
		userId: 'user-123',
		notes: null,
		accessInstructions: null,
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		photos: [],
	}
}

describe('getMyListings Sentry threshold signal', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns empty array without signaling when unauthenticated', async () => {
		mockGetSession.mockResolvedValue(null)

		const result = await getMyListings()

		expect(result).toEqual([])
		expect(mockCaptureMessage).not.toHaveBeenCalled()
	})

	it('does not signal when listing count is 15', async () => {
		mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
		mockGetUserListings.mockResolvedValue(
			Array.from({ length: 15 }, (_, index) => makeListing(index + 1))
		)

		const result = await getMyListings()

		expect(result).toHaveLength(15)
		expect(mockCaptureMessage).not.toHaveBeenCalled()
	})

	it('signals with structured metadata when listing count exceeds 15', async () => {
		mockGetSession.mockResolvedValue({ user: { id: 'user-123' } })
		mockGetUserListings.mockResolvedValue(
			Array.from({ length: 16 }, (_, index) => makeListing(index + 1))
		)

		const result = await getMyListings()

		expect(result).toHaveLength(16)
		expect(mockCaptureMessage).toHaveBeenCalledWith(
			'User has more than 15 listings',
			expect.objectContaining({
				level: 'warning',
				extra: { userId: 'user-123', listingCount: 16 },
			})
		)
	})
})
