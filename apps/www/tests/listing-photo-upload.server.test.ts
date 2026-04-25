/**
 * Unit tests for listing photo upload logic.
 *
 * Covers the four key risks called out in docs/0004-listing-photos.md PR 3:
 *   - wrong MIME type rejected
 *   - oversized file rejected
 *   - unrecognized magic bytes rejected
 *   - auth guard (tested in listing-photo-api.server.test.ts against the server fn)
 */
import { PassThrough } from 'node:stream'
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
// Production streams through .jpeg() — mock the transform chain.
// ============================================================================

const mockConcurrency = vi.fn()
const mockJpeg = vi.fn()
const mockSharp = vi.fn()

vi.mock('sharp', () => ({
	default: Object.assign(mockSharp, { concurrency: mockConcurrency }),
}))

vi.mock('../src/lib/env.server', () => ({
	serverEnv: {
		SHARP_CONCURRENCY: 1,
	},
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
		readStream: vi.fn(),
		readWebStream: vi.fn(),
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
		mockJpeg.mockReturnValue(new PassThrough())
		mockSharp.mockReturnValue({ jpeg: mockJpeg })
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

	it('sets sharp concurrency from SHARP_CONCURRENCY before processing', async () => {
		const storage = makeStorage()
		process.env.SHARP_CONCURRENCY = '1'

		await uploadListingPhoto({
			rawBuffer: Buffer.from('raw-img'),
			mimeType: 'image/png',
			fileExt: '.png',
			storage,
		})

		expect(mockConcurrency).toHaveBeenCalledWith(1)
	})

	it('converts to JPEG and streams the clean image to pub/ dir', async () => {
		const storage = makeStorage()

		await uploadListingPhoto({
			rawBuffer: Buffer.from('raw-img'),
			mimeType: 'image/png',
			fileExt: '.png',
			storage,
		})

		expect(mockSharp).toHaveBeenCalledWith({ sequentialRead: true })
		expect(mockJpeg).toHaveBeenCalled()

		const { calls } = (storage.upload as ReturnType<typeof vi.fn>).mock
		const pubCall = calls.find((c: unknown[]) => c[0] === 'pub')
		expect(pubCall).toBeDefined()
		expect(Buffer.isBuffer(pubCall![2])).toBeFalsy()
		expect(pubCall![2]).toHaveProperty('pipe')
	})

	it('pub path is always .jpg regardless of input extension', async () => {
		const storage = makeStorage()

		await uploadListingPhoto({
			rawBuffer: Buffer.from('img'),
			mimeType: 'image/webp',
			fileExt: '.webp',
			storage,
		})

		const { calls } = (storage.upload as ReturnType<typeof vi.fn>).mock
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
