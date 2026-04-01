/**
 * Unit tests for listing photo query functions.
 * Uses the mock-DB pattern established in getUserLastAddress.server.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { latLngToCell } from 'h3-js'

// ============================================================================
// Mock drizzle db
// ============================================================================

const mockInsert = vi.fn()
const mockInsertValues = vi.fn()
const mockInsertReturning = vi.fn()

const mockSelect = vi.fn()
const mockSelectFrom = vi.fn()
const mockSelectWhere = vi.fn()
const mockSelectOrderBy = vi.fn()

const mockDelete = vi.fn()
const mockDeleteWhere = vi.fn()
const mockDeleteReturning = vi.fn()

const mockUpdate = vi.fn()
const mockUpdateSet = vi.fn()
const mockUpdateWhere = vi.fn()

vi.mock('../src/data/db.server', () => ({
	db: {
		insert: (...args: unknown[]) => {
			mockInsert(...args)
			return { values: mockInsertValues }
		},
		select: (...args: unknown[]) => {
			return mockSelect(...args)
		},
		delete: (...args: unknown[]) => {
			mockDelete(...args)
			return { where: mockDeleteWhere }
		},
		update: (...args: unknown[]) => {
			mockUpdate(...args)
			return { set: mockUpdateSet }
		},
	},
}))

mockInsertValues.mockReturnValue({ returning: mockInsertReturning })
mockSelect.mockReturnValue({ from: mockSelectFrom })
mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
mockSelectWhere.mockReturnValue({ orderBy: mockSelectOrderBy })
mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning })
mockUpdateSet.mockReturnValue({ where: mockUpdateWhere })

// Must import after mocking
const {
	addPhotoToListing,
	getPhotosForListing,
	deleteListingPhoto,
	getPublicListingById,
	getAvailableListings,
	DataInvariantError,
} = await import('../src/data/queries.server')

// ============================================================================
// Test fixtures
// ============================================================================

const NAPA = { lat: 38.2975, lng: -122.2869 }

/** Builds a minimal full Listing row suitable for toPublicListing. */
function makeListingRow(id: number, overrides: Record<string, unknown> = {}) {
	return {
		id,
		name: `${faker.person.firstName()}'s fig tree`,
		type: 'fig',
		variety: null,
		status: 'available',
		quantity: 'abundant',
		harvestWindow: 'June-September',
		address: faker.location.streetAddress(),
		city: 'Napa',
		state: 'CA',
		zip: '94558',
		lat: NAPA.lat,
		lng: NAPA.lng,
		h3Index: latLngToCell(NAPA.lat, NAPA.lng, 13),
		userId: faker.string.uuid(),
		notes: null,
		accessInstructions: null,
		deletedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	}
}

// ============================================================================
// addPhotoToListing
// ============================================================================

describe('addPhotoToListing', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockInsertValues.mockReturnValue({ returning: mockInsertReturning })
	})

	it('returns the inserted row', async () => {
		const listingId = faker.number.int({ min: 1, max: 9999 })
		const rawKey = `raw/listings/${listingId}/abc.jpg`
		const pubUrl = `pub/listings/${listingId}/abc.jpg`
		const inserted = {
			id: faker.number.int(),
			listingId,
			rawKey,
			pubUrl,
			order: 0,
			createdAt: new Date(),
			deletedAt: null,
		}
		mockInsertReturning.mockResolvedValue([inserted])

		const result = await addPhotoToListing(listingId, rawKey, pubUrl, 0)

		expect(result).toEqual(inserted)
	})

	it('passes all four arguments to the insert', async () => {
		const listingId = faker.number.int({ min: 1, max: 9999 })
		const rawKey = `raw/listings/${listingId}/img.jpg`
		const pubUrl = `pub/listings/${listingId}/img.jpg`
		const order = 2
		mockInsertReturning.mockResolvedValue([
			{
				id: 1,
				listingId,
				rawKey,
				pubUrl,
				order,
				createdAt: new Date(),
				deletedAt: null,
			},
		])

		await addPhotoToListing(listingId, rawKey, pubUrl, order)

		expect(mockInsertValues).toHaveBeenCalledWith({
			listingId,
			rawKey,
			pubUrl,
			order,
		})
	})

	it('throws DataInvariantError when the insert returns no row', async () => {
		mockInsertReturning.mockResolvedValue([])

		await expect(addPhotoToListing(1, 'raw/x', 'pub/x', 0)).rejects.toThrow(
			DataInvariantError
		)
	})
})

// ============================================================================
// getPhotosForListing
// ============================================================================

describe('getPhotosForListing', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockSelectFrom.mockReturnValue({ where: mockSelectWhere })
		mockSelectWhere.mockReturnValue({ orderBy: mockSelectOrderBy })
	})

	it('returns an empty array when there are no photos', async () => {
		mockSelectOrderBy.mockResolvedValue([])

		const result = await getPhotosForListing(42)

		expect(result).toEqual([])
	})

	it('returns photos with id, pubUrl, and order', async () => {
		const listingId = faker.number.int({ min: 1, max: 9999 })
		const photos = [
			{ id: 1, pubUrl: `pub/listings/${listingId}/a.jpg`, order: 0 },
			{ id: 2, pubUrl: `pub/listings/${listingId}/b.jpg`, order: 1 },
		]
		mockSelectOrderBy.mockResolvedValue(photos)

		const result = await getPhotosForListing(listingId)

		expect(result).toEqual(photos)
	})

	it('passes a projection to db.select that includes id/pubUrl/order but not rawKey', async () => {
		mockSelectOrderBy.mockResolvedValue([])

		await getPhotosForListing(1)

		// Verifies the Drizzle projection object — rawKey must never be selected
		// (the mock controls the return value, so result-shape checks would be tautological)
		expect(mockSelect).toHaveBeenCalledWith(
			expect.objectContaining({
				id: expect.anything(),
				pubUrl: expect.anything(),
				order: expect.anything(),
			})
		)
		expect(mockSelect).not.toHaveBeenCalledWith(
			expect.objectContaining({ rawKey: expect.anything() })
		)
	})
})

// ============================================================================
// deleteListingPhoto
// ============================================================================

describe('deleteListingPhoto', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning })
	})

	it('returns rawKey and pubUrl of the deleted photo', async () => {
		const rawKey = 'raw/listings/1/img.jpg'
		const pubUrl = 'pub/listings/1/img.jpg'
		mockDeleteReturning.mockResolvedValue([{ rawKey, pubUrl }])

		const result = await deleteListingPhoto(1, 'user-abc')

		expect(result).toEqual({ rawKey, pubUrl })
	})

	it('returns undefined when the photo does not exist or is not owned by the user', async () => {
		// A single undefined return covers both "not found" and "wrong owner" —
		// the SQL WHERE clause enforces ownership so only the owner's photo is deleted.
		mockDeleteReturning.mockResolvedValue([])

		const result = await deleteListingPhoto(999_999, 'some-other-user')

		expect(result).toBeUndefined()
	})
})

// ============================================================================
// getPublicListingById — listing + photo wiring
// ============================================================================

describe('getPublicListingById', () => {
	/** Sets up a mock chain for a db.select() that ends in .limit(n). */
	function mockSelectWithLimit(rows: unknown[]) {
		const mockLimit = vi.fn().mockResolvedValue(rows)
		const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
		const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
		mockSelect.mockReturnValueOnce({ from: mockFrom })
	}

	/** Sets up a mock chain for a db.select() that ends in .orderBy(). */
	function mockSelectWithOrderBy(rows: unknown[]) {
		const mockOrderBy = vi.fn().mockResolvedValue(rows)
		const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
		const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
		mockSelect.mockReturnValueOnce({ from: mockFrom })
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns a PublicListing with photos and coverPhotoUrl populated', async () => {
		const listingId = 42
		const listing = makeListingRow(listingId)
		const photoRows = [
			{ id: 1, listingId, pubUrl: `pub/listings/${listingId}/a.jpg`, order: 0 },
		]

		// Promise.all: first db.select() → listing, second → photos
		mockSelectWithLimit([listing])
		mockSelectWithOrderBy(photoRows)

		const result = await getPublicListingById(listingId)

		expect(result).toBeDefined()
		expect(result!.photos).toHaveLength(1)
		expect(result!.photos[0].pubUrl).toBe(`pub/listings/${listingId}/a.jpg`)
		expect(result!.photos[0].order).toBe(0)
		expect(result!.coverPhotoUrl).toBe(`pub/listings/${listingId}/a.jpg`)
	})

	it('returns a PublicListing with empty photos when listing has no photos', async () => {
		const listingId = 7
		mockSelectWithLimit([makeListingRow(listingId)])
		mockSelectWithOrderBy([])

		const result = await getPublicListingById(listingId)

		expect(result).toBeDefined()
		expect(result!.photos).toEqual([])
		expect(result!.coverPhotoUrl).toBeNull()
	})

	it('returns undefined when the listing is not found', async () => {
		// Both queries still run (Promise.all); listing returns empty
		mockSelectWithLimit([])
		mockSelectWithOrderBy([]) // photos fetch still runs but is irrelevant

		const result = await getPublicListingById(999)

		expect(result).toBeUndefined()
	})
})

// ============================================================================
// fetchPhotosByListingIds grouping (via getAvailableListings)
// ============================================================================

describe('fetchPhotosByListingIds grouping (via getAvailableListings)', () => {
	/** Sets up a mock chain for db.select().from().where().orderBy().limit(). */
	function mockSelectWithOrderByAndLimit(rows: unknown[]) {
		const mockLimit = vi.fn().mockResolvedValue(rows)
		const mockOrderBy = vi.fn().mockReturnValue({ limit: mockLimit })
		const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
		const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
		mockSelect.mockReturnValueOnce({ from: mockFrom })
	}

	/** Sets up a mock chain for db.select().from().where().orderBy(). */
	function mockSelectWithOrderBy(rows: unknown[]) {
		const mockOrderBy = vi.fn().mockResolvedValue(rows)
		const mockWhere = vi.fn().mockReturnValue({ orderBy: mockOrderBy })
		const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
		mockSelect.mockReturnValueOnce({ from: mockFrom })
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('groups interleaved photo rows by listingId', async () => {
		const listing1 = makeListingRow(1)
		const listing2 = makeListingRow(2)
		mockSelectWithOrderByAndLimit([listing1, listing2])

		// fetchPhotosByListingIds returns rows for both listings, interleaved
		const photoRows = [
			{ id: 10, listingId: 1, pubUrl: 'pub/1/a.jpg', order: 0 },
			{ id: 20, listingId: 2, pubUrl: 'pub/2/a.jpg', order: 0 },
			{ id: 11, listingId: 1, pubUrl: 'pub/1/b.jpg', order: 1 },
		]
		mockSelectWithOrderBy(photoRows)

		const results = await getAvailableListings(10)

		expect(results).toHaveLength(2)

		const r1 = results.find((r) => r.id === 1)!
		expect(r1.photos).toHaveLength(2)
		expect(r1.photos.map((p) => p.pubUrl)).toEqual(['pub/1/a.jpg', 'pub/1/b.jpg'])
		expect(r1.coverPhotoUrl).toBe('pub/1/a.jpg')

		const r2 = results.find((r) => r.id === 2)!
		expect(r2.photos).toHaveLength(1)
		expect(r2.coverPhotoUrl).toBe('pub/2/a.jpg')
	})

	it('uses [] photos for listings with no matching photo rows', async () => {
		const listing = makeListingRow(99)
		mockSelectWithOrderByAndLimit([listing])
		mockSelectWithOrderBy([]) // no photos for this listing

		const results = await getAvailableListings(10)

		expect(results).toHaveLength(1)
		expect(results[0].photos).toEqual([])
		expect(results[0].coverPhotoUrl).toBeNull()
	})
})
