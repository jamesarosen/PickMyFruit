/**
 * Unit tests for listing photo upload logic.
 *
 * Covers the four key risks called out in docs/0004-listing-photos.md PR 3:
 *   - wrong MIME type rejected
 *   - oversized file rejected
 *   - unrecognized magic bytes rejected
 *   - auth guard (tested in listing-photo-api.server.test.ts against the server fn)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import type { StorageAdapter } from '../src/lib/storage.server'

// ============================================================================
// Mock mime-bytes — avoids real magic-byte detection in unit tests.
// ============================================================================

const mockDetectFromBuffer = vi.fn()

vi.mock('mime-bytes', () => ({
	detectFromBuffer: (...args: unknown[]) => mockDetectFromBuffer(...args),
}))

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
	const smallBuf = Buffer.from('fake')
	const fiveMb = Buffer.alloc(5 * 1024 * 1024)
	const sixMb = Buffer.alloc(6 * 1024 * 1024)

	it('accepts image/jpeg', async () => {
		mockDetectFromBuffer.mockResolvedValue({ mimeType: 'image/jpeg' })
		await expect(validatePhotoFile(smallBuf)).resolves.toBe('image/jpeg')
	})

	it('accepts image/png', async () => {
		mockDetectFromBuffer.mockResolvedValue({ mimeType: 'image/png' })
		await expect(validatePhotoFile(smallBuf)).resolves.toBe('image/png')
	})

	it('accepts image/webp', async () => {
		mockDetectFromBuffer.mockResolvedValue({ mimeType: 'image/webp' })
		await expect(validatePhotoFile(smallBuf)).resolves.toBe('image/webp')
	})

	it('rejects files with unrecognized magic bytes', async () => {
		mockDetectFromBuffer.mockResolvedValue(null)
		await expect(validatePhotoFile(smallBuf)).rejects.toThrow()
	})

	it('rejects non-image MIME types detected from bytes', async () => {
		mockDetectFromBuffer.mockResolvedValue({ mimeType: 'application/pdf' })
		await expect(validatePhotoFile(smallBuf)).rejects.toThrow()
	})

	it('rejects image/gif (not in the allowed set)', async () => {
		mockDetectFromBuffer.mockResolvedValue({ mimeType: 'image/gif' })
		await expect(validatePhotoFile(smallBuf)).rejects.toThrow()
	})

	it('rejects files over 5 MB', async () => {
		mockDetectFromBuffer.mockResolvedValue({ mimeType: 'image/jpeg' })
		await expect(validatePhotoFile(sixMb)).rejects.toThrow()
	})

	it('accepts files exactly at 5 MB', async () => {
		mockDetectFromBuffer.mockResolvedValue({ mimeType: 'image/jpeg' })
		await expect(validatePhotoFile(fiveMb)).resolves.toBe('image/jpeg')
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
