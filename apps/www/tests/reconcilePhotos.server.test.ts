/**
 * Unit tests for reconcilePendingPhotos.
 * Mocks the DB queries and headPhoto client — no real HTTP or DB.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'

// ============================================================================
// Mock photoServiceClient
// ============================================================================

const mockHeadPhoto = vi.fn()

vi.mock('../src/lib/photoServiceClient.server', () => ({
	headPhoto: (...args: unknown[]) => mockHeadPhoto(...args),
}))

// ============================================================================
// Mock DB queries
// ============================================================================

const mockGetPendingPhotosOlderThan = vi.fn()
const mockMarkPhotoComplete = vi.fn()
const mockAbandonPhoto = vi.fn()

vi.mock('../src/data/queries.server', () => ({
	getPendingPhotosOlderThan: (...args: unknown[]) =>
		mockGetPendingPhotosOlderThan(...args),
	markPhotoComplete: (...args: unknown[]) => mockMarkPhotoComplete(...args),
	abandonPhoto: (...args: unknown[]) => mockAbandonPhoto(...args),
}))

// ============================================================================
// Mock Sentry — swallow captureException calls
// ============================================================================

const mockCaptureException = vi.fn()

vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		captureException: (...args: unknown[]) => mockCaptureException(...args),
	},
}))

// ============================================================================
// Mock logger — silence output in tests
// ============================================================================

vi.mock('../src/lib/logger.server', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}))

// Must import after mocking
const { reconcilePendingPhotos } =
	await import('../src/lib/reconcilePhotos.server')

const THRESHOLD_MS = 60_000 // 60 s — must match the constant in reconcilePhotos.server.ts
const ABANDON_MS = 24 * 60 * 60_000 // 24 h

function makePhoto(overrides: Partial<{ id: string; createdAt: Date }> = {}): {
	id: string
	createdAt: Date
} {
	return {
		id: faker.string.uuid(),
		createdAt: new Date(Date.now() - THRESHOLD_MS - 1000), // older than threshold by default
		...overrides,
	}
}

describe('reconcilePendingPhotos', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockMarkPhotoComplete.mockResolvedValue(undefined)
		mockGetPendingPhotosOlderThan.mockResolvedValue([])
		mockAbandonPhoto.mockResolvedValue(undefined)
	})

	it('marks a pending photo complete when HEAD returns exists=true', async () => {
		const photo = makePhoto()
		mockGetPendingPhotosOlderThan.mockResolvedValue([photo])
		mockHeadPhoto.mockResolvedValue({ exists: true })

		await reconcilePendingPhotos()

		expect(mockMarkPhotoComplete).toHaveBeenCalledWith(photo.id)
		expect(mockAbandonPhoto).not.toHaveBeenCalled()
	})

	it('leaves a photo pending when HEAD returns exists=false and photo is < 24 h old', async () => {
		// Older than the 60 s threshold, but younger than 24 h → still in-flight
		const photo = makePhoto({
			createdAt: new Date(Date.now() - ABANDON_MS + 60_000), // 23 h 59 m old
		})
		mockGetPendingPhotosOlderThan.mockResolvedValue([photo])
		mockHeadPhoto.mockResolvedValue({ exists: false })

		await reconcilePendingPhotos()

		expect(mockMarkPhotoComplete).not.toHaveBeenCalled()
		expect(mockAbandonPhoto).not.toHaveBeenCalled()
	})

	it('abandons a photo when HEAD returns exists=false and photo is > 24 h old', async () => {
		const photo = makePhoto({
			createdAt: new Date(Date.now() - ABANDON_MS - 1000), // 24+ h old
		})
		mockGetPendingPhotosOlderThan.mockResolvedValue([photo])
		mockHeadPhoto.mockResolvedValue({ exists: false })

		await reconcilePendingPhotos()

		expect(mockAbandonPhoto).toHaveBeenCalledWith(photo.id)
		expect(mockMarkPhotoComplete).not.toHaveBeenCalled()
	})

	it('skips photos younger than the threshold (not returned by getPendingPhotosOlderThan)', async () => {
		// The DB query itself filters by age; reconcile should only call complete/abandon
		// for photos returned — so if none are returned, nothing happens.
		mockGetPendingPhotosOlderThan.mockResolvedValue([])

		await reconcilePendingPhotos()

		expect(mockHeadPhoto).not.toHaveBeenCalled()
		expect(mockMarkPhotoComplete).not.toHaveBeenCalled()
		expect(mockAbandonPhoto).not.toHaveBeenCalled()
	})

	it('is a no-op when there are 0 pending photos', async () => {
		mockGetPendingPhotosOlderThan.mockResolvedValue([])

		await expect(reconcilePendingPhotos()).resolves.toBeUndefined()

		expect(mockMarkPhotoComplete).not.toHaveBeenCalled()
		expect(mockAbandonPhoto).not.toHaveBeenCalled()
	})

	it('swallows headPhoto errors and captures them via Sentry, continuing for other photos', async () => {
		const errorPhoto = makePhoto()
		const goodPhoto = makePhoto()
		mockGetPendingPhotosOlderThan.mockResolvedValue([errorPhoto, goodPhoto])

		const error = new Error('network failure')
		mockHeadPhoto
			.mockRejectedValueOnce(error) // first call throws
			.mockResolvedValueOnce({ exists: true }) // second call succeeds

		await reconcilePendingPhotos()

		// The error must be captured, not re-thrown
		expect(mockCaptureException).toHaveBeenCalledWith(error, expect.anything())

		// The sweep must continue: the good photo should be completed
		expect(mockMarkPhotoComplete).toHaveBeenCalledWith(goodPhoto.id)
		expect(mockMarkPhotoComplete).not.toHaveBeenCalledWith(errorPhoto.id)
	})

	it('passes the correct threshold to getPendingPhotosOlderThan', async () => {
		mockGetPendingPhotosOlderThan.mockResolvedValue([])

		await reconcilePendingPhotos()

		expect(mockGetPendingPhotosOlderThan).toHaveBeenCalledWith(THRESHOLD_MS)
	})
})
