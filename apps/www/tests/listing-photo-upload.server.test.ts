import { describe, it, expect, beforeEach } from 'vitest'
import {
	validatePhotoFile,
	assertPhotoUploadCapacity,
	MAX_FILE_SIZE_BYTES,
	MAX_UPLOAD_QUEUE_DEPTH,
	getQueueDepth,
	incrementQueueDepth,
	decrementQueueDepth,
} from '../src/lib/listing-photo-upload.server'
import type { UserError } from '../src/lib/user-error'

// Magic byte signatures for image formats
const JPEG_MAGIC = Buffer.from([
	0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// WebP: RIFF????WEBP
const WEBP_MAGIC = Buffer.from([
	0x52,
	0x49,
	0x46,
	0x46, // RIFF
	0x00,
	0x00,
	0x00,
	0x00, // file size (placeholder)
	0x57,
	0x45,
	0x42,
	0x50, // WEBP
])
const GIF_MAGIC = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a

function makePaddedBuffer(magic: Buffer, totalSize = 64): Buffer {
	const buf = Buffer.alloc(totalSize)
	magic.copy(buf)
	return buf
}

// ============================================================================
// validatePhotoFile
// ============================================================================

describe('validatePhotoFile', () => {
	it('accepts a valid JPEG', async () => {
		const buf = makePaddedBuffer(JPEG_MAGIC)
		const result = await validatePhotoFile(buf)
		expect(result).toBe('image/jpeg')
	})

	it('accepts a valid PNG', async () => {
		const buf = makePaddedBuffer(PNG_MAGIC)
		const result = await validatePhotoFile(buf)
		expect(result).toBe('image/png')
	})

	it('accepts a valid WebP', async () => {
		const buf = makePaddedBuffer(WEBP_MAGIC, 64)
		const result = await validatePhotoFile(buf)
		expect(result).toBe('image/webp')
	})

	it('rejects a GIF (wrong magic bytes)', async () => {
		const buf = makePaddedBuffer(GIF_MAGIC)
		const error = await validatePhotoFile(buf).catch((e: unknown) => e)
		expect((error as UserError).code).toBe('INVALID_MIME_TYPE')
	})

	it('rejects a buffer that exceeds the size limit', async () => {
		const oversized = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1)
		JPEG_MAGIC.copy(oversized)
		const error = await validatePhotoFile(oversized).catch((e: unknown) => e)
		expect((error as UserError).code).toBe('FILE_TOO_LARGE')
	})
})

// ============================================================================
// assertPhotoUploadCapacity
// ============================================================================

describe('assertPhotoUploadCapacity', () => {
	beforeEach(() => {
		// Reset module-level queue depth to 0 before each test
		while (getQueueDepth() > 0) decrementQueueDepth()
	})

	it('succeeds when the queue is empty', () => {
		expect(() => assertPhotoUploadCapacity()).not.toThrow()
	})

	it('succeeds when the queue is one below the limit', () => {
		for (let i = 0; i < MAX_UPLOAD_QUEUE_DEPTH - 1; i++) incrementQueueDepth()
		expect(() => assertPhotoUploadCapacity()).not.toThrow()
	})

	it('throws SERVER_BUSY when the queue is at the concurrency limit', () => {
		for (let i = 0; i < MAX_UPLOAD_QUEUE_DEPTH; i++) incrementQueueDepth()
		expect(() => assertPhotoUploadCapacity()).toThrow()
		const error = (() => {
			try {
				assertPhotoUploadCapacity()
			} catch (e) {
				return e
			}
		})()
		expect((error as UserError).code).toBe('SERVER_BUSY')
		expect((error as UserError).status).toBe(503)
	})
})
