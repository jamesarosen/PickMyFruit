import { v7 as uuidv7 } from 'uuid'
import { detectFromBuffer } from 'mime-bytes'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { serverEnv } from '@/lib/env.server'
import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'
import type { StorageAdapter } from '@/lib/storage.server'
import { UserError } from '@/lib/user-error'

export const ALLOWED_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

export const MAX_IMAGE_PIXELS = 16_000_000

/**
 * Cap on the long edge of the public copy. Listing photos don't need full
 * sensor resolution; with this cap libvips' JPEG shrink-on-load decodes the
 * input at 1/2, 1/4, or 1/8, which is the dominant memory win in the pub
 * pipeline.
 */
export const PUB_MAX_DIMENSION = 2048

const MIME_TO_EXT = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
} as const

export type ALLOWED_EXT = (typeof MIME_TO_EXT)[keyof typeof MIME_TO_EXT]

const sharp = (await import('sharp')).default
sharp.concurrency(serverEnv.SHARP_CONCURRENCY)
// libvips' tile/operation cache fights V8 for RAM on a 256 MB VM.
sharp.cache(false)

/**
 * Cap on uploads in flight (running + queued). Past this we shed load with a
 * 503 instead of holding more 5 MB temp files and Sharp pixel buffers around.
 * TODO: move image processing to a background worker so the web tier doesn't
 * have to gate on its own RAM budget.
 */
export const MAX_UPLOAD_QUEUE_DEPTH = 4

/**
 * Serial promise queue: ensures only one uploadListingPhoto runs at a time
 * across the process. Two simultaneous uploads would otherwise hold two raw
 * temp files and two Sharp pixel buffers in RAM at once — enough to push the
 * 512 MB Fly VM over its OOM threshold even after resize-before-encode.
 */
let queueTail: Promise<unknown> = Promise.resolve()
let queueDepth = 0

interface LockInfo {
	lockWaitMs: number
	depthAtAcquire: number
}

function withUploadLock<T>(fn: (info: LockInfo) => Promise<T>): Promise<T> {
	if (queueDepth >= MAX_UPLOAD_QUEUE_DEPTH) {
		throw new UserError(
			'SERVER_BUSY',
			'The server is busy processing other photo uploads. Please try again in a moment.',
			503
		)
	}
	queueDepth++
	const enqueuedAt = Date.now()
	const run = async () => {
		const info: LockInfo = {
			lockWaitMs: Date.now() - enqueuedAt,
			depthAtAcquire: queueDepth,
		}
		return fn(info)
	}
	const result = queueTail.then(run, run).finally(() => {
		queueDepth--
	})
	queueTail = result.catch(() => undefined)
	return result
}

/** Synchronous capacity check — call before staging the request body to disk. */
export function assertPhotoUploadCapacity(): void {
	if (queueDepth >= MAX_UPLOAD_QUEUE_DEPTH) {
		throw new UserError(
			'SERVER_BUSY',
			'The server is busy processing other photo uploads. Please try again in a moment.',
			503
		)
	}
}

/**
 * Validates that a buffer is an allowed image type and within the size limit.
 * Detects the actual MIME type from magic bytes — the client-supplied Content-Type
 * is intentionally ignored.
 * Returns the narrowed MIME type on success; throws a UserError on failure.
 *
 * iPhone users frequently have HEIC files — the error message tells them to
 * convert rather than leaving them confused.
 */
export async function validatePhotoFile(
	buffer: Buffer
): Promise<AllowedMimeType> {
	const detected = await detectFromBuffer(buffer)
	const mimeType = detected?.mimeType ?? 'application/octet-stream'
	if (!ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
		throw new UserError(
			'INVALID_MIME_TYPE',
			'Only JPEG, PNG, and WebP images are allowed. iPhone HEIC photos must be converted first.'
		)
	}
	if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
		throw new UserError('FILE_TOO_LARGE', 'Photo must be 5 MB or smaller')
	}
	return mimeType as AllowedMimeType
}

/** Returns the file extension for an allowed MIME type. */
export function mimeToExt(mimeType: AllowedMimeType): ALLOWED_EXT {
	return MIME_TO_EXT[mimeType]
}

/**
 * Streams an upload to a unique temp file and returns its path. Buffering the
 * upload in memory (`Buffer.from(await file.arrayBuffer())`) was the dominant
 * peak-RSS contributor on the 256 MB Fly VM — staging to disk lets the request
 * body, the raw archive copy, and the Sharp pipeline each consume the bytes
 * via independent streams.
 */
export async function stageUploadStream(
	webStream: ReadableStream<Uint8Array>
): Promise<string> {
	const tempPath = join(tmpdir(), `pmf-upload-${uuidv7()}`)
	// Cast bridges DOM's ReadableStream and node:stream/web's, which differ in
	// their type defs even though Node accepts both at runtime.
	await pipeline(
		Readable.fromWeb(webStream as Parameters<typeof Readable.fromWeb>[0]),
		createWriteStream(tempPath)
	)
	return tempPath
}

/** Reads the first 4 KB of a staged upload and validates magic bytes. */
export async function detectMimeFromTempFile(
	tempPath: string
): Promise<AllowedMimeType> {
	const fd = await open(tempPath)
	try {
		const { buffer, bytesRead } = await fd.read(Buffer.alloc(4096), 0, 4096, 0)
		return validatePhotoFile(buffer.subarray(0, bytesRead))
	} finally {
		await fd.close()
	}
}

/** Best-effort cleanup of a staged temp file; never throws. */
export async function unlinkUploadStaging(tempPath: string): Promise<void> {
	await unlink(tempPath).catch(() => undefined)
}

/**
 * Uploads a photo to both raw/ (private, full EXIF) and pub/ (public, EXIF-stripped)
 * storage, and returns the ID to be used in paths.
 *
 * Reads from `tempPath` twice (one stream per upload) so neither pass needs
 * to buffer the full file in memory. Cleans up the raw/ object if the pub/
 * upload fails, to avoid orphaning a private file that contains full EXIF.
 */
export function uploadListingPhoto(opts: {
	tempPath: string
	mimeType: AllowedMimeType
	fileExt: string
	storage: StorageAdapter
}): Promise<{ id: string }> {
	return withUploadLock((info) => uploadListingPhotoLocked(opts, info))
}

async function uploadListingPhotoLocked(
	opts: {
		tempPath: string
		mimeType: AllowedMimeType
		fileExt: string
		storage: StorageAdapter
	},
	lockInfo: LockInfo
): Promise<{ id: string }> {
	const id = uuidv7()
	const rawPathKey = `listing_photos/${id}${opts.fileExt}`
	const pubPathKey = `listing_photos/${id}.jpg`

	logger.info(
		{
			phase: 'start',
			listingPhotoId: id,
			rssBytes: process.memoryUsage().rss,
			lockWaitMs: lockInfo.lockWaitMs,
			depthAtAcquire: lockInfo.depthAtAcquire,
		},
		'uploadListingPhoto'
	)

	let phase: 'end' | 'error' = 'end'
	try {
		const rawBytes = (await stat(opts.tempPath)).size

		// Store original with full EXIF intact — private, server-side only.
		// ContentLength is required so `lib-storage`'s small-body fallback to
		// PutObject doesn't go out chunked-encoded (Tigris rejects that with
		// MissingContentLength).
		await opts.storage.upload(
			'raw',
			rawPathKey,
			createReadStream(opts.tempPath),
			{
				mimeType: opts.mimeType,
				photoId: id,
				contentLength: rawBytes,
			}
		)

		try {
			await Sentry.startSpan(
				{
					name: 'photo.sharp_transform',
					op: 'image.process',
					attributes: {
						'photo.id': id,
						'photo.mime_type': opts.mimeType,
						'photo.lock_wait_ms': lockInfo.lockWaitMs,
						'photo.queue_depth_at_acquire': lockInfo.depthAtAcquire,
					},
				},
				async (span) => {
					const rssBefore = process.memoryUsage().rss
					const inputBytes = (await stat(opts.tempPath)).size
					const inputMeta = await sharp(opts.tempPath).metadata()

					span.setAttribute('photo.input_bytes', inputBytes)
					span.setAttribute('photo.input_orientation', inputMeta.orientation ?? 1)
					span.setAttribute('photo.input_width', inputMeta.width ?? 0)
					span.setAttribute('photo.input_height', inputMeta.height ?? 0)
					span.setAttribute('photo.rss_before', rssBefore)

					// libvips cache snapshot — process-global counters, captured here
					// to confirm sharp.cache(false) is honored on the linux build.
					// `_high` is the high-water mark since process start, not per-image.
					const cacheSnapshot = sharp.cache()
					span.setAttribute(
						'sharp.cache_memory_current',
						cacheSnapshot.memory.current
					)
					span.setAttribute('sharp.cache_memory_high', cacheSnapshot.memory.high)
					span.setAttribute('sharp.cache_files_current', cacheSnapshot.files.current)
					span.setAttribute('sharp.cache_items_current', cacheSnapshot.items.current)

					span.setAttribute('photo.pub_max_dimension', PUB_MAX_DIMENSION)
					// Order matters: rotate first so .resize() targets display-oriented
					// dimensions. For JPEG input, libvips uses shrink-on-load to decode
					// at 1/2, 1/4, or 1/8 — the dominant memory win on the pub pipeline.
					//
					// Encode to a Buffer (not a stream) so the upload has a known
					// ContentLength. After resize-to-PUB_MAX_DIMENSION the encoded JPEG
					// is ~0.2–2 MB; the peak-memory cost of buffering is negligible
					// compared to the libvips working set, and it lets Tigris accept
					// the body without chunked transfer encoding.
					const { data: pubBuffer, info } = await sharp(opts.tempPath, {
						sequentialRead: true,
						limitInputPixels: MAX_IMAGE_PIXELS,
					})
						.autoOrient()
						.resize({
							width: PUB_MAX_DIMENSION,
							height: PUB_MAX_DIMENSION,
							fit: 'inside',
							withoutEnlargement: true,
						})
						.jpeg({ quality: 85, mozjpeg: true })
						.toBuffer({ resolveWithObject: true })
					span.setAttribute('photo.output_width', info.width)
					span.setAttribute('photo.output_height', info.height)
					span.setAttribute('photo.output_bytes', info.size)

					try {
						// Public copy served from CDN
						await opts.storage.upload('pub', pubPathKey, Readable.from(pubBuffer), {
							mimeType: 'image/jpeg',
							photoId: id,
							contentLength: pubBuffer.byteLength,
						})
					} finally {
						const rssAfter = process.memoryUsage().rss
						span.setAttribute('photo.rss_after', rssAfter)
						span.setAttribute('photo.rss_delta', rssAfter - rssBefore)
					}
				}
			)
		} catch (err) {
			// Clean up the raw/ object so it doesn't linger without a DB record —
			// raw/ holds full EXIF (incl. GPS) so an orphan is a privacy issue.
			// If deletion fails, capture so an ops script can reconcile.
			await opts.storage.delete('raw', rawPathKey).catch((delErr) => {
				Sentry.captureException(delErr, {
					extra: { phase: 'raw cleanup after pub failure', rawPathKey },
				})
			})
			if (err instanceof Error && /pixel limit/i.test(err.message)) {
				throw new UserError(
					'IMAGE_TOO_LARGE',
					'Photo resolution exceeds 16 megapixels — please resize before uploading.'
				)
			}
			if (
				err instanceof Error &&
				/vipsjpeg|premature end|corrupt/i.test(err.message)
			) {
				throw new UserError(
					'CORRUPT_IMAGE',
					'The photo could not be decoded. Please try a different file.'
				)
			}
			throw err
		}

		return { id }
	} catch (err) {
		phase = 'error'
		throw err
	} finally {
		logger.info(
			{
				phase,
				listingPhotoId: id,
				rssBytes: process.memoryUsage().rss,
			},
			'uploadListingPhoto'
		)
	}
}
