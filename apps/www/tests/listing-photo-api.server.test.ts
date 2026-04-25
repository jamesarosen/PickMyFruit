/**
 * Unit tests for the listing photo server functions.
 * Focuses on the auth guard — the one risk that lives in the server fn layer,
 * not in the pure upload logic tested in listing-photo-upload.server.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import type { UserError } from '../src/lib/user-error'

// ============================================================================
// Mock auth — controls session presence
// ============================================================================

const mockGetSession = vi.fn()

vi.mock('../src/lib/auth.server', () => ({
	auth: {
		api: {
			getSession: mockGetSession,
		},
	},
}))

// ============================================================================
// Mock queries — avoid real DB
// ============================================================================

const mockGetListingById = vi.fn()
const mockAddPhotoToListing = vi.fn()
const mockDeleteListingPhoto = vi.fn()

vi.mock('../src/data/queries.server', () => ({
	getListingById: (...args: unknown[]) => mockGetListingById(...args),
	addPhotoToListing: (...args: unknown[]) => mockAddPhotoToListing(...args),
	deleteListingPhoto: (...args: unknown[]) => mockDeleteListingPhoto(...args),
}))

// ============================================================================
// Mock storage — avoid filesystem
// ============================================================================

vi.mock('../src/lib/storage.server', () => ({
	storage: {
		upload: vi.fn().mockResolvedValue(undefined),
		read: vi.fn(),
		readStream: vi.fn(),
		publicUrl: vi.fn((key: string) => `/api/uploads/pub/${key}`),
		delete: vi.fn().mockResolvedValue(undefined),
	},
}))

// ============================================================================
// Mock sharp — avoids native binary
// ============================================================================

const mockSharpJpeg = vi.fn(() => ({ pipe: vi.fn() }))
const mockSharpWithExif = vi.fn(() => ({ jpeg: mockSharpJpeg }))

vi.mock('sharp', () => ({
	default: Object.assign(
		vi.fn((input: unknown) => {
			if (Buffer.isBuffer(input)) {
				return {
					metadata: vi.fn().mockResolvedValue({ orientation: 1 }),
				}
			}
			return {
				withExif: mockSharpWithExif,
			}
		}),
		{ concurrency: vi.fn() }
	),
}))

// Must import after mocking
const { addPhotoToListing, deletePhoto } =
	await import('../src/api/listing-photos')

// ============================================================================
// addPhotoToListing — auth guard
// ============================================================================

describe('addPhotoToListing', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('throws when the user is not authenticated', async () => {
		mockGetSession.mockResolvedValue(null)

		const fd = new FormData()
		fd.append('listingId', '42')
		fd.append(
			'photo',
			new File([Buffer.from('x')], 'photo.jpg', { type: 'image/jpeg' })
		)
		const error = await addPhotoToListing({ data: fd }).catch((e: unknown) => e)
		expect((error as UserError).code).toBe('AUTH_REQUIRED')
	})

	it('throws NOT_FOUND when the authenticated user does not own the listing', async () => {
		const userId = faker.string.uuid()
		mockGetSession.mockResolvedValue({ user: { id: userId } })

		const fd = new FormData()
		fd.append('listingId', '42')
		fd.append(
			'photo',
			new File([Buffer.from('x')], 'photo.jpg', { type: 'image/jpeg' })
		)

		// Listing exists but belongs to a different user
		mockGetListingById.mockResolvedValue({ id: 42, userId: faker.string.uuid() })

		const error = await addPhotoToListing({ data: fd }).catch((e: unknown) => e)
		expect((error as UserError).code).toBe('NOT_FOUND')
	})
})

// ============================================================================
// deletePhoto — auth guard
// ============================================================================

describe('deletePhoto', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('throws when the user is not authenticated', async () => {
		mockGetSession.mockResolvedValue(null)

		await expect(
			deletePhoto({
				data: { photoId: faker.string.uuid() },
			})
		).rejects.toThrow()
	})

	it('throws NOT_FOUND when the photo does not belong to the authenticated user', async () => {
		mockGetSession.mockResolvedValue({ user: { id: faker.string.uuid() } })
		// deleteListingPhoto returns undefined when the SQL ownership check finds nothing
		mockDeleteListingPhoto.mockResolvedValue(undefined)

		const error = await deletePhoto({
			data: { photoId: faker.string.uuid() },
		}).catch((e: unknown) => e)
		expect((error as UserError).code).toBe('NOT_FOUND')
	})
})
