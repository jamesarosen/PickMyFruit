/**
 * Integration test: verifies that the sharp call in uploadListingPhoto actually
 * strips EXIF metadata (including GPS coordinates) from the public copy.
 *
 * Uses a real JPEG fixture with GPS data; exiftool-vendored reads EXIF tags from
 * the processed buffer to confirm removal. This test does NOT mock sharp.
 */
import { describe, it, expect, afterAll, afterEach } from 'vitest'
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { exiftool } from 'exiftool-vendored'
import type { StorageAdapter, StorageBody } from '../src/lib/storage.server'

// No vi.mock('sharp') — exercises the real native binary.
const sharp = (await import('sharp')).default
const { uploadListingPhoto, MAX_IMAGE_PIXELS, PUB_MAX_DIMENSION } =
	await import('../src/lib/listing-photo-upload.server')

afterAll(() => exiftool.end())

describe('EXIF stripping (real sharp)', () => {
	const tempPaths: string[] = []
	afterEach(() => {
		while (tempPaths.length > 0) {
			try {
				unlinkSync(tempPaths.pop()!)
			} catch {
				// already gone
			}
		}
	})

	function stageRawBuffer(rawBuffer: Buffer): string {
		const path = join(tmpdir(), `pmf-exif-stage-${Date.now()}-${Math.random()}`)
		writeFileSync(path, rawBuffer)
		tempPaths.push(path)
		return path
	}

	async function captureUpload(
		tempPath: string,
		mimeType: 'image/jpeg' | 'image/png' | 'image/webp',
		fileExt: string
	): Promise<Buffer> {
		let pubBuffer: Buffer | undefined
		const storage: StorageAdapter = {
			upload: async (dir: string, _key: string, body: StorageBody) => {
				if (dir === 'pub') {
					pubBuffer = Buffer.concat(await Readable.from(body).toArray())
				}
			},
			read: async () => {
				throw new Error('not implemented')
			},
			readStream: async () => {
				throw new Error('not implemented')
			},
			readWebStream: async () => {
				throw new Error('not implemented')
			},
			publicUrl: (key: string) => `/api/uploads/pub/${key}`,
			delete: async () => {},
		}
		await uploadListingPhoto({ tempPath, mimeType, fileExt, storage })
		expect(pubBuffer).toBeDefined()
		return pubBuffer!
	}

	// ExifTool spawns a subprocess on first use; allow extra time for startup.
	it('removes GPS tags from the public copy', { timeout: 30_000 }, async () => {
		const rawBuffer = readFileSync(join(__dirname, 'fixtures/flower-bees.jpg'))
		const pubBuffer = await captureUpload(
			stageRawBuffer(rawBuffer),
			'image/jpeg',
			'.jpg'
		)

		const tmpPath = join(tmpdir(), `pmf-exif-test-${Date.now()}.jpg`)
		writeFileSync(tmpPath, pubBuffer)
		try {
			const tags = await exiftool.read(tmpPath)
			expect(tags.GPSLatitude).toBeUndefined()
			expect(tags.GPSLongitude).toBeUndefined()
			expect(tags.GPSPosition).toBeUndefined()
		} finally {
			unlinkSync(tmpPath)
		}
	})

	it(
		'auto-orients real-sized images (regression: sequentialRead skipped rotation)',
		{ timeout: 30_000 },
		async () => {
			// 1024×768 keeps libvips out of its small-image fallback path, where
			// rotation works regardless of input access mode. The previous 8×4
			// fixture passed even when sequentialRead silently dropped rotation.
			const rawBuffer = await sharp({
				create: {
					width: 1024,
					height: 768,
					channels: 3,
					background: { r: 10, g: 20, b: 30 },
				},
			})
				.withMetadata({ orientation: 6 })
				.jpeg()
				.toBuffer()

			const pubBuffer = await captureUpload(
				stageRawBuffer(rawBuffer),
				'image/jpeg',
				'.jpg'
			)

			const pubMeta = await sharp(pubBuffer).metadata()
			expect(pubMeta.width).toBe(768)
			expect(pubMeta.height).toBe(1024)
			expect(pubMeta.orientation).toBeUndefined()
		}
	)

	it(
		'caps the public copy at PUB_MAX_DIMENSION on the long edge',
		{ timeout: 30_000 },
		async () => {
			// Long edge 2400 → expected to shrink to 2048; aspect preserved.
			const rawBuffer = await sharp({
				create: {
					width: 2400,
					height: 1200,
					channels: 3,
					background: { r: 200, g: 100, b: 50 },
				},
			})
				.jpeg()
				.toBuffer()

			const pubBuffer = await captureUpload(
				stageRawBuffer(rawBuffer),
				'image/jpeg',
				'.jpg'
			)

			const pubMeta = await sharp(pubBuffer).metadata()
			expect(pubMeta.width).toBe(PUB_MAX_DIMENSION)
			expect(pubMeta.height).toBe(PUB_MAX_DIMENSION / 2)
		}
	)

	it(
		'rejects images exceeding MAX_IMAGE_PIXELS with IMAGE_TOO_LARGE',
		{ timeout: 30_000 },
		async () => {
			// One pixel over the cap. Sharp's `limitInputPixels` rejects at
			// pipeline read; the catch handler in uploadListingPhoto rethrows
			// as a UserError.
			const overLimit = MAX_IMAGE_PIXELS + 1
			const width = 5000
			const height = Math.ceil(overLimit / width)
			const rawBuffer = await sharp({
				create: {
					width,
					height,
					channels: 3,
					background: { r: 0, g: 0, b: 0 },
				},
			})
				.jpeg()
				.toBuffer()

			const error = await captureUpload(
				stageRawBuffer(rawBuffer),
				'image/jpeg',
				'.jpg'
			).catch((err: unknown) => err)
			expect((error as { code?: string }).code).toBe('IMAGE_TOO_LARGE')
		}
	)

	it(
		'auto-orients pixels and drops orientation metadata on the public copy',
		{ timeout: 30_000 },
		async () => {
			const rawBuffer = await sharp({
				create: {
					width: 8,
					height: 4,
					channels: 3,
					background: { r: 10, g: 20, b: 30 },
				},
			})
				.withMetadata({ orientation: 6 })
				.jpeg()
				.toBuffer()

			const pubBuffer = await captureUpload(
				stageRawBuffer(rawBuffer),
				'image/jpeg',
				'.jpg'
			)

			const pubMeta = await sharp(pubBuffer).metadata()
			expect(pubMeta.width).toBe(4)
			expect(pubMeta.height).toBe(8)
			expect(pubMeta.orientation).toBeUndefined()

			const tmpPath = join(tmpdir(), `pmf-orient-test-${Date.now()}.jpg`)
			writeFileSync(tmpPath, pubBuffer)
			try {
				const tags = await exiftool.read(tmpPath)
				expect(tags.Orientation).toBeUndefined()
				expect(tags.GPSLatitude).toBeUndefined()
			} finally {
				unlinkSync(tmpPath)
			}
		}
	)
})
