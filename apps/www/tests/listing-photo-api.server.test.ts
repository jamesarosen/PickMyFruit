/**
 * Unit tests for the listing photo server functions.
 * Focuses on the auth guard — the one risk that lives in the server fn layer,
 * not in the pure upload logic tested in listing-photo-upload.server.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import type { UserError } from '../src/lib/user-error'
import { getRequest } from '@tanstack/solid-start/server'

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

		// uploadPhoto reads FormData from the raw request; auth is checked before
		// getRequest() is called, so no FormData setup is needed for this test.
		await expect(uploadPhoto()).rejects.toThrow()
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
		;(getRequest as ReturnType<typeof vi.fn>).mockResolvedValue({
			formData: () => Promise.resolve(fd),
		})

		// Listing exists but belongs to a different user
		mockGetListingById.mockResolvedValue({ id: 42, userId: faker.string.uuid() })

		const error = await uploadPhoto().catch((e: unknown) => e)
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
				data: { photoId: faker.number.int({ min: 1, max: 999 }) },
			})
		).rejects.toThrow()
	})

	it('throws NOT_FOUND when the photo does not belong to the authenticated user', async () => {
		mockGetSession.mockResolvedValue({ user: { id: faker.string.uuid() } })
		// deleteListingPhoto returns undefined when the SQL ownership check finds nothing
		mockDeleteListingPhoto.mockResolvedValue(undefined)

		const error = await deletePhoto({
			data: { photoId: faker.number.int({ min: 1, max: 999 }) },
		}).catch((e: unknown) => e)
		expect((error as UserError).code).toBe('NOT_FOUND')
	})
})
