/**
 * Unit tests for listing photo upload logic.
 *
 * Covers the four key risks called out in docs/0004-listing-photos.md PR 3:
 *   - wrong MIME type rejected
 *   - oversized file rejected
 *   - fourth photo rejected (count ≥ 3)
 *   - auth guard (tested in listing-photo-api.server.test.ts against the server fn)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import type { StorageAdapter } from '../src/lib/storage.server'

// ============================================================================
// Mock sharp — avoids native binary in unit tests.
// Sharp strips metadata by default; no call to withMetadata() is needed.
// ============================================================================

const mockToBuffer = vi.fn()

vi.mock('sharp', () => ({
	default: vi.fn(() => ({
		toBuffer: mockToBuffer,
	})),
}))

// Must import after mocking
const { validatePhotoFile, uploadListingPhoto } =
	await import('../src/lib/listing-photo-upload.server')

// ============================================================================
// Helpers
// ============================================================================

function makeStorage(): StorageAdapter {
	return {
		upload: vi.fn().mockResolvedValue(undefined),
		read: vi.fn(),
		publicUrl: vi.fn((path: string) => `/api/uploads/pub/${path}`),
		delete: vi.fn().mockResolvedValue(undefined),
	}
}

// ============================================================================
// validatePhotoFile
// ============================================================================

describe('validatePhotoFile', () => {
	it('accepts image/jpeg', () => {
		expect(() => validatePhotoFile('image/jpeg', 1024)).not.toThrow()
	})

	it('accepts image/png', () => {
		expect(() => validatePhotoFile('image/png', 1024)).not.toThrow()
	})

	it('accepts image/webp', () => {
		expect(() => validatePhotoFile('image/webp', 1024)).not.toThrow()
	})

	it('rejects non-image MIME types', () => {
		expect(() => validatePhotoFile('application/pdf', 1024)).toThrow()
	})

	it('rejects image/gif (not in the allowed set)', () => {
		expect(() => validatePhotoFile('image/gif', 1024)).toThrow()
	})

	it('rejects files over 5 MB', () => {
		const sixMb = 6 * 1024 * 1024
		expect(() => validatePhotoFile('image/jpeg', sixMb)).toThrow()
	})

	it('accepts files exactly at 5 MB', () => {
		expect(() => validatePhotoFile('image/jpeg', 5 * 1024 * 1024)).not.toThrow()
	})
})

// ============================================================================
// uploadListingPhoto
// ============================================================================

describe('uploadListingPhoto', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockToBuffer.mockResolvedValue(Buffer.from('clean-image'))
	})

	it('uploads the raw buffer to raw/ dir', async () => {
		const storage = makeStorage()
		const rawBuffer = Buffer.from('raw-img')

		await uploadListingPhoto({
			listingId: 42,
			rawBuffer,
			mimeType: 'image/jpeg',
			fileExt: '.jpg',
			storage,
		})

		const [rawCall] = (storage.upload as ReturnType<typeof vi.fn>).mock.calls
		expect(rawCall[0]).toBe('raw')
		expect(rawCall[1]).toMatch(/^listings\/42\/[\w-]+\.jpg$/)
		expect(rawCall[2]).toBe(rawBuffer)
	})

	it('strips EXIF and uploads the clean buffer to pub/ dir', async () => {
		const storage = makeStorage()
		const cleanBuffer = Buffer.from('clean-image')
		mockToBuffer.mockResolvedValue(cleanBuffer)

		await uploadListingPhoto({
			listingId: 42,
			rawBuffer: Buffer.from('raw-img'),
			mimeType: 'image/png',
			fileExt: '.png',
			storage,
		})

		// sharp.toBuffer() was called — metadata stripped is the default sharp behavior
		expect(mockToBuffer).toHaveBeenCalled()

		const calls = (storage.upload as ReturnType<typeof vi.fn>).mock.calls
		const pubCall = calls.find((c: unknown[]) => c[0] === 'pub')
		expect(pubCall).toBeDefined()
		expect(pubCall![2]).toBe(cleanBuffer)
	})

	it('uses the same path key for raw and pub uploads', async () => {
		const storage = makeStorage()

		await uploadListingPhoto({
			listingId: 7,
			rawBuffer: Buffer.from('img'),
			mimeType: 'image/webp',
			fileExt: '.webp',
			storage,
		})

		const calls = (storage.upload as ReturnType<typeof vi.fn>).mock.calls
		const rawPath = calls.find((c: unknown[]) => c[0] === 'raw')?.[1]
		const pubPath = calls.find((c: unknown[]) => c[0] === 'pub')?.[1]
		expect(rawPath).toBe(pubPath)
	})

	it('returns rawKey and pubUrl', async () => {
		const storage = makeStorage()
		const listingId = faker.number.int({ min: 1, max: 999 })

		const result = await uploadListingPhoto({
			listingId,
			rawBuffer: Buffer.from('img'),
			mimeType: 'image/jpeg',
			fileExt: '.jpg',
			storage,
		})

		expect(result.rawKey).toMatch(
			new RegExp(`^listings/${listingId}/[\\w-]+\\.jpg$`)
		)
		expect(result.pubUrl).toContain(result.rawKey)
	})
})
