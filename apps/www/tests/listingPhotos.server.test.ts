/**
 * Unit tests for listing photo query functions.
 * Uses the mock-DB pattern established in getUserLastAddress.server.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { latLngToCell } from 'h3-js'

// ============================================================================
// Mock storage — provides predictable publicUrl output
// ============================================================================

vi.mock('../src/lib/storage.server', () => ({
	storage: {
		publicUrl: (path: string) => `https://cdn.example.com/${path}`,
	},
}))

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

const mockTransaction = vi.fn()

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
		transaction: (...args: unknown[]) => mockTransaction(...args),
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
	getNearbyListings,
	getUserListings,
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
	})

	/** Builds a mock transaction that resolves count then insert in sequence. */
	function mockTx(count: number, insertRows: unknown[]) {
		mockTransaction.mockImplementation(
			async (callback: (tx: unknown) => Promise<unknown>) => {
				const tx = {
					select: () => ({
						from: () => ({
							where: () => Promise.resolve([{ count }]),
						}),
					}),
					insert: () => ({
						values: () => ({
							returning: () => Promise.resolve(insertRows),
						}),
					}),
				}
				return callback(tx)
			}
		)
	}

	it('returns the inserted row when under the limit', async () => {
		const listingId = faker.number.int({ min: 1, max: 9999 })
		const id = faker.string.uuid()
		const ext = '.jpg'
		const inserted = {
			id,
			listingId,
			ext,
			order: 0,
			createdAt: new Date(),
			deletedAt: null,
		}
		mockTx(0, [inserted])

		const result = await addPhotoToListing(listingId, id, ext, 3)

		expect(result).toEqual(inserted)
	})

	it('returns null when the listing is already at the limit', async () => {
		mockTx(3, [])

		const result = await addPhotoToListing(1, faker.string.uuid(), '.jpg', 3)

		expect(result).toBeNull()
	})

	it('throws DataInvariantError when the insert returns no row', async () => {
		mockTx(0, [])

		await expect(
			addPhotoToListing(1, faker.string.uuid(), '.jpg', 3)
		).rejects.toThrow(DataInvariantError)
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

	it('preserves ascending `order` from the DB so photos[0] is the cover', async () => {
		const id0 = faker.string.uuid()
		const id1 = faker.string.uuid()
		const id2 = faker.string.uuid()
		// DB is queried with orderBy(listingPhotos.order) so rows arrive sorted;
		// the function must preserve that ordering end-to-end.
		mockSelectOrderBy.mockResolvedValue([
			{ id: id0, ext: '.jpg', order: 0 },
			{ id: id1, ext: '.jpg', order: 1 },
			{ id: id2, ext: '.jpg', order: 2 },
		])

		const result = await getPhotosForListing(1)

		expect(result.map((p) => p.id)).toEqual([id0, id1, id2])
		expect(result.map((p) => p.order)).toEqual([0, 1, 2])
	})

	it('pub URL is always .jpg regardless of raw ext', async () => {
		const listingId = faker.number.int({ min: 1, max: 9999 })
		const id1 = faker.string.uuid()
		const id2 = faker.string.uuid()
		const dbRows = [
			{ id: id1, ext: '.jpg', order: 0 },
			{ id: id2, ext: '.png', order: 1 },
		]
		mockSelectOrderBy.mockResolvedValue(dbRows)

		const result = await getPhotosForListing(listingId)

		expect(result[0].pubUrl).toBe(
			`https://cdn.example.com/listing_photos/${id1}.jpg`
		)
		expect(result[1].pubUrl).toBe(
			`https://cdn.example.com/listing_photos/${id2}.jpg`
		)
	})

	it('passes a projection to db.select that includes id/ext/order but not raw_key', async () => {
		mockSelectOrderBy.mockResolvedValue([])

		await getPhotosForListing(1)

		// Verifies the Drizzle projection — raw storage details must never be selected.
		expect(mockSelect).toHaveBeenCalledWith(
			expect.objectContaining({
				id: expect.anything(),
				ext: expect.anything(),
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

	it('returns id and ext of the deleted photo', async () => {
		const id = faker.string.uuid()
		mockDeleteReturning.mockResolvedValue([{ id, ext: '.jpg' }])

		const result = await deleteListingPhoto(id, 'user-abc')

		expect(result).toEqual({ id, ext: '.jpg' })
	})

	it('returns undefined when the photo does not exist or is not owned by the user', async () => {
		// A single undefined return covers both "not found" and "wrong owner" —
		// the SQL WHERE clause enforces ownership so only the owner's photo is deleted.
		mockDeleteReturning.mockResolvedValue([])

		const result = await deleteListingPhoto(
			faker.string.uuid(),
			'some-other-user'
		)

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

	it('returns a PublicListing with photos populated', async () => {
		const listingId = 42
		const listing = makeListingRow(listingId)
		const photoId = faker.string.uuid()
		const photoRows = [{ id: photoId, listingId, ext: '.jpg', order: 0 }]

		// Promise.all: first db.select() → listing, second → photos
		mockSelectWithLimit([listing])
		mockSelectWithOrderBy(photoRows)

		const result = await getPublicListingById(listingId)

		expect(result).toBeDefined()
		expect(result!.photos).toHaveLength(1)
		expect(result!.photos[0].pubUrl).toBe(
			`https://cdn.example.com/listing_photos/${photoId}.jpg`
		)
		expect(result!.photos[0].order).toBe(0)
	})

	it('returns photos sorted by `order` ascending so photos[0] is the cover', async () => {
		const listingId = 42
		const idA = faker.string.uuid()
		const idB = faker.string.uuid()
		const idC = faker.string.uuid()

		mockSelectWithLimit([makeListingRow(listingId)])
		// The DB query uses orderBy(listingPhotos.order); simulate that by
		// supplying rows in ascending-order sequence.
		mockSelectWithOrderBy([
			{ id: idA, listingId, ext: '.jpg', order: 0 },
			{ id: idB, listingId, ext: '.jpg', order: 1 },
			{ id: idC, listingId, ext: '.jpg', order: 2 },
		])

		const result = await getPublicListingById(listingId)

		expect(result!.photos.map((p) => p.id)).toEqual([idA, idB, idC])
		expect(result!.photos.map((p) => p.order)).toEqual([0, 1, 2])
	})

	it('returns a PublicListing with empty photos when listing has no photos', async () => {
		const listingId = 7
		mockSelectWithLimit([makeListingRow(listingId)])
		mockSelectWithOrderBy([])

		const result = await getPublicListingById(listingId)

		expect(result).toBeDefined()
		expect(result!.photos).toEqual([])
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

		const id10 = faker.string.uuid()
		const id11 = faker.string.uuid()
		const id20 = faker.string.uuid()
		// fetchPhotosByListingIds returns rows for both listings, interleaved
		const photoRows = [
			{ id: id10, listingId: 1, ext: '.jpg', order: 0 },
			{ id: id20, listingId: 2, ext: '.jpg', order: 0 },
			{ id: id11, listingId: 1, ext: '.jpg', order: 1 },
		]
		mockSelectWithOrderBy(photoRows)

		const results = await getAvailableListings(10)

		expect(results).toHaveLength(2)

		const r1 = results.find((r) => r.id === 1)!
		expect(r1.photos).toHaveLength(2)
		expect(r1.photos.map((p) => p.pubUrl)).toEqual([
			`https://cdn.example.com/listing_photos/${id10}.jpg`,
			`https://cdn.example.com/listing_photos/${id11}.jpg`,
		])

		const r2 = results.find((r) => r.id === 2)!
		expect(r2.photos).toHaveLength(1)
		expect(r2.photos[0].pubUrl).toBe(
			`https://cdn.example.com/listing_photos/${id20}.jpg`
		)
	})

	it('uses [] photos for listings with no matching photo rows', async () => {
		const listing = makeListingRow(99)
		mockSelectWithOrderByAndLimit([listing])
		mockSelectWithOrderBy([]) // no photos for this listing

		const results = await getAvailableListings(10)

		expect(results).toHaveLength(1)
		expect(results[0].photos).toEqual([])
	})

	it('preserves `order` ascending so photos[0] is the cover', async () => {
		const listingId = 7
		mockSelectWithOrderByAndLimit([makeListingRow(listingId)])

		const id0 = faker.string.uuid()
		const id1 = faker.string.uuid()
		const id2 = faker.string.uuid()
		// fetchPhotosByListingIds queries DB with orderBy(listingPhotos.order);
		// simulate that by providing rows in ascending-order sequence.
		mockSelectWithOrderBy([
			{ id: id0, listingId, ext: '.jpg', order: 0 },
			{ id: id1, listingId, ext: '.jpg', order: 1 },
			{ id: id2, listingId, ext: '.jpg', order: 2 },
		])

		const results = await getAvailableListings(10)

		expect(results[0].photos.map((p) => p.id)).toEqual([id0, id1, id2])
		expect(results[0].photos.map((p) => p.order)).toEqual([0, 1, 2])
	})
})

// ============================================================================
// getNearbyListings — photo ordering invariant
// ============================================================================

describe('getNearbyListings photo ordering', () => {
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

	it('returns photos sorted by `order` ascending so photos[0] is the cover', async () => {
		const listingId = 3
		mockSelectWithOrderByAndLimit([makeListingRow(listingId)])

		const id0 = faker.string.uuid()
		const id1 = faker.string.uuid()
		mockSelectWithOrderBy([
			{ id: id0, listingId, ext: '.jpg', order: 0 },
			{ id: id1, listingId, ext: '.jpg', order: 1 },
		])

		const results = await getNearbyListings(38.3, -122.3, 12)

		expect(results[0].photos.map((p) => p.id)).toEqual([id0, id1])
		expect(results[0].photos.map((p) => p.order)).toEqual([0, 1])
	})
})

// ============================================================================
// getUserListings — photo ordering invariant
// ============================================================================

describe('getUserListings photo ordering', () => {
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

	it('returns each listing with photos sorted by `order` ascending', async () => {
		const userId = faker.string.uuid()
		const listingA = makeListingRow(1, { userId })
		const listingB = makeListingRow(2, { userId })
		// getUserListings: first select ends at .orderBy(desc(listings.createdAt)) (no .limit())
		mockSelectWithOrderBy([listingA, listingB])

		const idA0 = faker.string.uuid()
		const idA1 = faker.string.uuid()
		const idB0 = faker.string.uuid()
		// fetchPhotosByListingIds: interleaved rows simulating globally sorted
		// result from the DB. The grouping must preserve ascending order
		// per listing.
		mockSelectWithOrderBy([
			{ id: idA0, listingId: 1, ext: '.jpg', order: 0 },
			{ id: idB0, listingId: 2, ext: '.jpg', order: 0 },
			{ id: idA1, listingId: 1, ext: '.jpg', order: 1 },
		])

		const results = await getUserListings(userId)

		const a = results.find((r) => r.id === 1)!
		const b = results.find((r) => r.id === 2)!
		expect(a.photos.map((p) => p.id)).toEqual([idA0, idA1])
		expect(a.photos.map((p) => p.order)).toEqual([0, 1])
		expect(b.photos.map((p) => p.id)).toEqual([idB0])
	})
})
