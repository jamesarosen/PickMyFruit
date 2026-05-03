/**
 * Legacy Sharp-based image pipeline for listing photos.
 *
 * This module initialises libvips (Sharp) at load time and must NOT be imported
 * by the upload route (`api/listing-photos.ts`). It exists so the old pipeline
 * can still be tested and referenced until it is fully retired in favour of the
 * photos-service path.
 */
import { v7 as uuidv7 } from 'uuid'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { serverEnv } from '@/lib/env.server'
import { logger } from '@/lib/logger.server'
import { Sentry } from '@/lib/sentry'
import type { StorageAdapter } from '@/lib/storage.server'
import { UserError } from '@/lib/user-error'
import {
	MAX_UPLOAD_QUEUE_DEPTH,
	getQueueDepth,
	incrementQueueDepth,
	decrementQueueDepth,
	type AllowedMimeType,
} from '@/lib/listing-photo-upload.server'

export const MAX_IMAGE_PIXELS = 16_000_000

/**
 * Cap on the long edge of the public copy. Listing photos don't need full
 * sensor resolution; with this cap libvips' JPEG shrink-on-load decodes the
 * input at 1/2, 1/4, or 1/8, which is the dominant memory win in the pub
 * pipeline.
 */
export const PUB_MAX_DIMENSION = 2048

const sharp = (await import('sharp')).default
sharp.concurrency(serverEnv.SHARP_CONCURRENCY)
// libvips' tile/operation cache fights V8 for RAM on a 256 MB VM.
sharp.cache(false)

interface LockInfo {
	lockWaitMs: number
	depthAtAcquire: number
}

let queueTail: Promise<unknown> = Promise.resolve()

function withUploadLock<T>(fn: (info: LockInfo) => Promise<T>): Promise<T> {
	if (getQueueDepth() >= MAX_UPLOAD_QUEUE_DEPTH) {
		throw new UserError(
			'SERVER_BUSY',
			'The server is busy processing other photo uploads. Please try again in a moment.',
			503
		)
	}
	incrementQueueDepth()
	const enqueuedAt = Date.now()
	const run = () => {
		const info: LockInfo = {
			lockWaitMs: Date.now() - enqueuedAt,
			depthAtAcquire: getQueueDepth(),
		}
		return fn(info)
	}
	const result = queueTail.then(run, run).finally(() => {
		decrementQueueDepth()
	})
	queueTail = result.catch(() => undefined)
	return result
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
		// Store original with full EXIF intact — private, server-side only
		await opts.storage.upload(
			'raw',
			rawPathKey,
			createReadStream(opts.tempPath),
			{
				mimeType: opts.mimeType,
				photoId: id,
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
					// Resize before autoOrient: libvips' JPEG shrink-on-load decodes at
					// 1/2, 1/4, or 1/8 scale when resize is the first pipeline step —
					// the dominant memory win. The square fit-inside target (2048×2048)
					// means final pixel dimensions are identical regardless of order, so
					// autoOrient on the already-small buffer is safe and cheap.
					const transform = sharp({
						sequentialRead: true,
						limitInputPixels: MAX_IMAGE_PIXELS,
					})
						.resize({
							width: PUB_MAX_DIMENSION,
							height: PUB_MAX_DIMENSION,
							fit: 'inside',
							withoutEnlargement: true,
						})
						.autoOrient()
						.jpeg({ quality: 85, mozjpeg: true })
					transform.on('info', (info: import('sharp').OutputInfo) => {
						span.setAttribute('photo.output_width', info.width)
						span.setAttribute('photo.output_height', info.height)
						span.setAttribute('photo.output_bytes', info.size)
					})
					const cleanStream = createReadStream(opts.tempPath).pipe(transform)

					try {
						// Public copy served from CDN
						await opts.storage.upload('pub', pubPathKey, cleanStream, {
							mimeType: 'image/jpeg',
							photoId: id,
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
