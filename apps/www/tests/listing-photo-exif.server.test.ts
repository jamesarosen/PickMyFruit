/**
 * Integration test: verifies that the sharp call in uploadListingPhoto actually
 * strips EXIF metadata (including GPS coordinates) from the public copy.
 *
 * Uses a real JPEG fixture with GPS data; exiftool-vendored reads EXIF tags from
 * the processed buffer to confirm removal. This test does NOT mock sharp.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exiftool } from 'exiftool-vendored'
import type { StorageAdapter } from '../src/lib/storage.server'

// No vi.mock('sharp') — exercises the real native binary.
const { uploadListingPhoto } =
	await import('../src/lib/listing-photo-upload.server')

afterAll(() => exiftool.end())

describe('EXIF stripping (real sharp)', () => {
	// ExifTool spawns a subprocess on first use; allow extra time for startup.
	it('removes GPS tags from the public copy', { timeout: 30_000 }, async () => {
		const rawBuffer = readFileSync(join(__dirname, 'fixtures/flower-bees.jpg'))

		// Capture the buffer passed to storage.upload('pub', ...)
		let pubBuffer: Buffer | undefined
		const storage: StorageAdapter = {
			upload: async (dir: string, _key: string, buf: Buffer) => {
				if (dir === 'pub') pubBuffer = buf
			},
			read: async () => {
				throw new Error('not implemented')
			},
			publicUrl: (key: string) => `/api/uploads/pub/${key}`,
			delete: async () => {},
		}

		await uploadListingPhoto({
			rawBuffer,
			mimeType: 'image/jpeg',
			fileExt: '.jpg',
			storage,
		})

		expect(pubBuffer).toBeDefined()

		// Write to a temp file so exiftool-vendored can read it
		const tmpPath = join(tmpdir(), `pmf-exif-test-${Date.now()}.jpg`)
		writeFileSync(tmpPath, pubBuffer!)
		try {
			const tags = await exiftool.read(tmpPath)
			expect(tags.GPSLatitude).toBeUndefined()
			expect(tags.GPSLongitude).toBeUndefined()
			expect(tags.GPSPosition).toBeUndefined()
		} finally {
			unlinkSync(tmpPath)
		}
	})
})
