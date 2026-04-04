/**
 * Unit tests for the listing photo server functions.
 * Focuses on the auth guard — the one risk that lives in the server fn layer,
 * not in the pure upload logic tested in listing-photo-upload.server.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'

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

const mockGetPhotosForListing = vi.fn()
const mockAddPhotoToListing = vi.fn()
const mockDeleteListingPhoto = vi.fn()

vi.mock('../src/data/queries.server', () => ({
	getPhotosForListing: (...args: unknown[]) => mockGetPhotosForListing(...args),
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
		publicUrl: vi.fn((key: string) => `/api/uploads/pub/${key}`),
		delete: vi.fn().mockResolvedValue(undefined),
	},
}))

// ============================================================================
// Mock sharp — avoids native binary
// ============================================================================

vi.mock('sharp', () => ({
	default: vi.fn(() => ({
		withMetadata: vi.fn().mockReturnValue({
			toBuffer: vi.fn().mockResolvedValue(Buffer.from('clean')),
		}),
	})),
}))

// Must import after mocking
const { uploadPhoto, deletePhoto } = await import('../src/api/listing-photos')

// ============================================================================
// uploadPhoto — auth guard
// ============================================================================

describe('uploadPhoto', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('throws when the user is not authenticated', async () => {
		mockGetSession.mockResolvedValue(null)

		await expect(
			uploadPhoto({
				data: {
					listingId: faker.number.int({ min: 1, max: 999 }),
					file: new File([Buffer.from('img')], 'photo.jpg', {
						type: 'image/jpeg',
					}),
				},
			})
		).rejects.toThrow()
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
				data: { photoId: faker.number.int({ min: 1, max: 999 }) },
			})
		).rejects.toThrow()
	})
})
