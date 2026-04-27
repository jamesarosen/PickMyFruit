/**
 * Unit-ish tests for listing photo upload framing.
 *
 * Sharp is *not* mocked. Tests run against tiny in-memory fixtures so the
 * real libvips pipeline executes end-to-end. The brittle chain mock (one
 * vi.fn per Sharp method, returning the next link) was replaced with this
 * approach: assertions check inputs/outputs (paths, ids, stream wiring,
 * mutex ordering, RSS log lines), not which Sharp methods were called.
 *
 * Behavior-level concerns (rotation, EXIF stripping, size caps, resize cap)
 * live in listing-photo-exif.server.test.ts — same dependency on real Sharp.
 */
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
	describe,
	it,
	expect,
	vi,
	beforeAll,
	beforeEach,
	afterEach,
} from 'vitest'
import type { StorageAdapter } from '../src/lib/storage.server'
import { UserError } from '../src/lib/user-error'

vi.mock('../src/lib/env.server', () => ({
	serverEnv: { SHARP_CONCURRENCY: 1 },
}))

const mockLoggerInfo = vi.fn()
vi.mock('../src/lib/logger.server', () => ({
	logger: {
		info: mockLoggerInfo,
		debug: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	},
}))

const sharp = (await import('sharp')).default
const {
	validatePhotoFile,
	uploadListingPhoto,
	assertPhotoUploadCapacity,
	MAX_UPLOAD_QUEUE_DEPTH,
} = await import('../src/lib/listing-photo-upload.server')

// One reusable real fixture per format. Tiny so the encode is instant.
let jpegFixture: Buffer
let pngFixture: Buffer
let webpFixture: Buffer
beforeAll(async () => {
	const base = sharp({
		create: {
			width: 10,
			height: 10,
			channels: 3,
			background: { r: 0, g: 128, b: 0 },
		},
	})
	jpegFixture = await base.clone().jpeg().toBuffer()
	pngFixture = await base.clone().png().toBuffer()
	webpFixture = await base.clone().webp().toBuffer()
})

function makeStorage(): StorageAdapter {
	return {
		// Drain stream bodies so the upstream createReadStream actually opens
		// the temp file before the test's afterEach removes it.
		upload: vi.fn().mockImplementation(async (_dir, _key, body) => {
			if (body && typeof body[Symbol.asyncIterator] === 'function') {
				for await (const _chunk of body) {
					// ignore
				}
			}
		}),
		read: vi.fn(),
		readStream: vi.fn(),
		readWebStream: vi.fn(),
		publicUrl: vi.fn((path: string) => `/api/uploads/pub/${path}`),
		delete: vi.fn().mockResolvedValue(undefined),
	}
}

// ============================================================================
// validatePhotoFile — real magic-byte detection on real bytes
// ============================================================================

describe('validatePhotoFile', () => {
	it('accepts a real JPEG', async () => {
		await expect(validatePhotoFile(jpegFixture)).resolves.toBe('image/jpeg')
	})

	it('accepts a real PNG', async () => {
		await expect(validatePhotoFile(pngFixture)).resolves.toBe('image/png')
	})

	it('accepts a real WebP', async () => {
		await expect(validatePhotoFile(webpFixture)).resolves.toBe('image/webp')
	})

	it('rejects bytes that match no known magic', async () => {
		await expect(
			validatePhotoFile(Buffer.from('not actually an image'))
		).rejects.toThrow()
	})

	it('rejects PDF magic bytes', async () => {
		await expect(
			validatePhotoFile(Buffer.from('%PDF-1.4\n%binary marker'))
		).rejects.toThrow()
	})

	it('rejects GIF (allowed-set excludes animation formats)', async () => {
		const gifMagic = Buffer.concat([
			Buffer.from('GIF89a'),
			Buffer.alloc(100), // padding so detectors that read more than 6 bytes succeed
		])
		await expect(validatePhotoFile(gifMagic)).rejects.toThrow()
	})

	it('rejects files over 5 MB', async () => {
		const oversized = Buffer.concat([
			jpegFixture,
			Buffer.alloc(5 * 1024 * 1024 + 1),
		])
		await expect(validatePhotoFile(oversized)).rejects.toThrow()
	})

	it('accepts files exactly at 5 MB', async () => {
		const exactlyFiveMb = Buffer.concat([
			jpegFixture,
			Buffer.alloc(5 * 1024 * 1024 - jpegFixture.byteLength),
		])
		await expect(validatePhotoFile(exactlyFiveMb)).resolves.toBe('image/jpeg')
	})
})

// ============================================================================
// uploadListingPhoto — framing & wiring (real Sharp pipeline)
// ============================================================================

describe('uploadListingPhoto', () => {
	let tempPaths: string[] = []

	function stage(buffer: Buffer): string {
		const path = join(tmpdir(), `pmf-test-upload-${Date.now()}-${Math.random()}`)
		writeFileSync(path, buffer)
		tempPaths.push(path)
		return path
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	afterEach(() => {
		for (const p of tempPaths) {
			try {
				unlinkSync(p)
			} catch {
				// already gone
			}
		}
		tempPaths = []
	})

	it('logs RSS at start and end of upload', async () => {
		await uploadListingPhoto({
			tempPath: stage(jpegFixture),
			mimeType: 'image/jpeg',
			fileExt: '.jpg',
			storage: makeStorage(),
		})

		const phases = mockLoggerInfo.mock.calls
			.map(([fields]) => fields as { phase?: string; rssBytes?: number })
			.filter((f) => f.phase === 'start' || f.phase === 'end')
		expect(phases.map((f) => f.phase)).toEqual(['start', 'end'])
		expect(phases[0]!.rssBytes).toBeTypeOf('number')
		expect(phases[1]!.rssBytes).toBeTypeOf('number')
	})

	it('streams the raw file to raw/ dir preserving input extension', async () => {
		const storage = makeStorage()
		await uploadListingPhoto({
			tempPath: stage(webpFixture),
			mimeType: 'image/webp',
			fileExt: '.webp',
			storage,
		})

		const [rawCall] = (storage.upload as ReturnType<typeof vi.fn>).mock.calls
		expect(rawCall[0]).toBe('raw')
		expect(rawCall[1]).toMatch(/^listing_photos\/[\w-]+\.webp$/)
		expect(rawCall[2]).toBeInstanceOf(Readable)
	})

	it('streams an image/jpeg body to pub/ dir regardless of input format', async () => {
		const storage = makeStorage()
		await uploadListingPhoto({
			tempPath: stage(pngFixture),
			mimeType: 'image/png',
			fileExt: '.png',
			storage,
		})

		const { calls } = (storage.upload as ReturnType<typeof vi.fn>).mock
		const pubCall = calls.find((c: unknown[]) => c[0] === 'pub')
		expect(pubCall).toBeDefined()
		expect(pubCall![2]).toBeInstanceOf(Readable)
		expect(pubCall![3]).toMatchObject({ mimeType: 'image/jpeg' })
	})

	it('opens distinct read streams for raw and pub uploads', async () => {
		const storage = makeStorage()
		await uploadListingPhoto({
			tempPath: stage(jpegFixture),
			mimeType: 'image/jpeg',
			fileExt: '.jpg',
			storage,
		})

		const { calls } = (storage.upload as ReturnType<typeof vi.fn>).mock
		const rawCall = calls.find((c: unknown[]) => c[0] === 'raw')
		const pubCall = calls.find((c: unknown[]) => c[0] === 'pub')
		// Two streams from the same file means we never buffered into a shared blob.
		expect(rawCall![2]).not.toBe(pubCall![2])
	})

	it('uses .jpg as the pub extension regardless of input extension', async () => {
		const storage = makeStorage()
		await uploadListingPhoto({
			tempPath: stage(webpFixture),
			mimeType: 'image/webp',
			fileExt: '.webp',
			storage,
		})

		const { calls } = (storage.upload as ReturnType<typeof vi.fn>).mock
		expect(calls.find((c: unknown[]) => c[0] === 'raw')?.[1]).toMatch(/\.webp$/)
		expect(calls.find((c: unknown[]) => c[0] === 'pub')?.[1]).toMatch(/\.jpg$/)
	})

	it('serializes concurrent uploads (mutex)', async () => {
		const events: string[] = []
		const slowStorage: StorageAdapter = {
			upload: vi.fn().mockImplementation(async (dir, _key, body) => {
				events.push(`${dir}-start`)
				if (body && typeof body[Symbol.asyncIterator] === 'function') {
					for await (const _chunk of body) {
						// drain
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 30))
				events.push(`${dir}-end`)
			}),
			read: vi.fn(),
			readStream: vi.fn(),
			readWebStream: vi.fn(),
			publicUrl: vi.fn((p: string) => `/api/uploads/pub/${p}`),
			delete: vi.fn().mockResolvedValue(undefined),
		}

		await Promise.all([
			uploadListingPhoto({
				tempPath: stage(jpegFixture),
				mimeType: 'image/jpeg',
				fileExt: '.jpg',
				storage: slowStorage,
			}),
			uploadListingPhoto({
				tempPath: stage(jpegFixture),
				mimeType: 'image/jpeg',
				fileExt: '.jpg',
				storage: slowStorage,
			}),
		])

		const firstPubEnd = events.indexOf('pub-end')
		const secondRawStart = events.lastIndexOf('raw-start')
		expect(firstPubEnd).toBeGreaterThanOrEqual(0)
		expect(secondRawStart).toBeGreaterThan(firstPubEnd)
	})

	it('throws SERVER_BUSY (503) when the upload queue is at capacity', async () => {
		// Slow storage so the four submitted uploads remain "in flight" long
		// enough for the capacity check to observe queueDepth at the cap. They
		// drain naturally via the 30 ms timeout — no manual release plumbing.
		const slowStorage: StorageAdapter = {
			upload: vi.fn().mockImplementation(async (_dir, _key, body) => {
				if (body && typeof body[Symbol.asyncIterator] === 'function') {
					for await (const _chunk of body) {
						// drain so the temp file isn't held open
					}
				}
				await new Promise((resolve) => setTimeout(resolve, 30))
			}),
			read: vi.fn(),
			readStream: vi.fn(),
			readWebStream: vi.fn(),
			publicUrl: vi.fn((p: string) => `/api/uploads/pub/${p}`),
			delete: vi.fn().mockResolvedValue(undefined),
		}

		const inFlight = Array.from({ length: MAX_UPLOAD_QUEUE_DEPTH }, () =>
			uploadListingPhoto({
				tempPath: stage(jpegFixture),
				mimeType: 'image/jpeg',
				fileExt: '.jpg',
				storage: slowStorage,
			})
		)

		// queueDepth is incremented synchronously in withUploadLock, so the
		// fifth call rejects before doing any work.
		let caught: unknown
		try {
			assertPhotoUploadCapacity()
		} catch (e) {
			caught = e
		}
		expect(caught).toBeInstanceOf(UserError)
		expect((caught as UserError).code).toBe('SERVER_BUSY')
		expect((caught as UserError).status).toBe(503)

		await Promise.all(inFlight)
	})

	it('returns an id matching the UUIDv7 pattern', async () => {
		const result = await uploadListingPhoto({
			tempPath: stage(jpegFixture),
			mimeType: 'image/jpeg',
			fileExt: '.jpg',
			storage: makeStorage(),
		})
		expect(result.id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/
		)
	})
})
