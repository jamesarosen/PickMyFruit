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
// Production calls .jpeg().toBuffer() — mock both methods in the chain.
// ============================================================================

const mockToBuffer = vi.fn()
const mockJpeg = vi.fn()

vi.mock('sharp', () => ({
	default: vi.fn(() => ({
		jpeg: mockJpeg,
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
		mockJpeg.mockReturnValue({ toBuffer: mockToBuffer })
		mockToBuffer.mockResolvedValue(Buffer.from('clean-image'))
	})

	it('uploads the raw buffer to raw/ dir preserving input extension', async () => {
		const storage = makeStorage()
		const rawBuffer = Buffer.from('raw-img')

		await uploadListingPhoto({
			rawBuffer,
			mimeType: 'image/webp',
			fileExt: '.webp',
			storage,
		})

		const [rawCall] = (storage.upload as ReturnType<typeof vi.fn>).mock.calls
		expect(rawCall[0]).toBe('raw')
		expect(rawCall[1]).toMatch(/^listing_photos\/[\w-]+\.webp$/)
		expect(rawCall[2]).toBe(rawBuffer)
	})

	it('converts to JPEG and uploads the clean buffer to pub/ dir', async () => {
		const storage = makeStorage()
		const cleanBuffer = Buffer.from('clean-image')
		mockToBuffer.mockResolvedValue(cleanBuffer)

		await uploadListingPhoto({
			rawBuffer: Buffer.from('raw-img'),
			mimeType: 'image/png',
			fileExt: '.png',
			storage,
		})

		// sharp().jpeg().toBuffer() was called — JPEG conversion + metadata strip
		expect(mockJpeg).toHaveBeenCalled()
		expect(mockToBuffer).toHaveBeenCalled()

		const calls = (storage.upload as ReturnType<typeof vi.fn>).mock.calls
		const pubCall = calls.find((c: unknown[]) => c[0] === 'pub')
		expect(pubCall).toBeDefined()
		expect(pubCall![2]).toBe(cleanBuffer)
	})

	it('pub path is always .jpg regardless of input extension', async () => {
		const storage = makeStorage()

		await uploadListingPhoto({
			rawBuffer: Buffer.from('img'),
			mimeType: 'image/webp',
			fileExt: '.webp',
			storage,
		})

		const calls = (storage.upload as ReturnType<typeof vi.fn>).mock.calls
		const rawPath = calls.find((c: unknown[]) => c[0] === 'raw')?.[1]
		const pubPath = calls.find((c: unknown[]) => c[0] === 'pub')?.[1]
		// Raw preserves input extension; pub is always JPEG
		expect(rawPath).toMatch(/\.webp$/)
		expect(pubPath).toMatch(/\.jpg$/)
	})

	it('returns id matching a UUID v7 pattern', async () => {
		const storage = makeStorage()

		const result = await uploadListingPhoto({
			rawBuffer: Buffer.from('img'),
			mimeType: 'image/jpeg',
			fileExt: '.jpg',
			storage,
		})

		// UUID v7: 8-4-4-4-12 hex chars, version nibble = 7
		expect(result.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
		)
	})
})
