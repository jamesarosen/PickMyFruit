import { v7 as uuidv7 } from 'uuid'
import { detectFromBuffer } from 'mime-bytes'
import type { StorageAdapter } from '@/lib/storage.server'
import { UserError } from '@/lib/user-error'

export const ALLOWED_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
export const MAX_PHOTOS_PER_LISTING = 3

const MIME_TO_EXT = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
} as const

export type ALLOWED_EXT = (typeof MIME_TO_EXT)[keyof typeof MIME_TO_EXT]

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
 * Uploads a photo to both raw/ (private, full EXIF) and pub/ (public, EXIF-stripped)
 * storage, and returns the shared path key.
 *
 * - `rawKey` — storage path used for both the raw and pub objects; persist to DB.
 *   The public URL is derived at read time via `storage.publicUrl(rawKey)`.
 *
 * Cleans up the raw/ object if the pub/ upload fails, to avoid orphaning a
 * private file that contains full EXIF.
 */
export async function uploadListingPhoto(opts: {
	rawBuffer: Buffer
	mimeType: AllowedMimeType
	fileExt: string
	storage: StorageAdapter
}): Promise<{ id: string }> {
	const id = uuidv7()
	const rawPathKey = `listing_photos/${id}${opts.fileExt}`
	const pubPathKey = `listing_photos/${id}.jpg`

	// Store original with full EXIF intact — private, server-side only
	await opts.storage.upload('raw', rawPathKey, opts.rawBuffer, {
		mimeType: opts.mimeType,
	})

	// Strip EXIF and convert to JPEG before serving publicly.
	// sharp strips all metadata by default; .jpeg() ensures uniform JPEG output
	// regardless of input format (PNG, WebP, etc.).
	const sharp = (await import('sharp')).default
	let cleanBuffer: Buffer
	try {
		cleanBuffer = await sharp(opts.rawBuffer).jpeg().toBuffer()
		// Public copy served from CDN
		await opts.storage.upload('pub', pubPathKey, cleanBuffer, {
			mimeType: 'image/jpeg',
		})
	} catch (err) {
		// Clean up the raw/ object so it doesn't linger without a DB record.
		// Best-effort: if deletion also fails, the error is swallowed — the
		// original error is what the caller needs to handle.
		await opts.storage.delete('raw', rawPathKey).catch(() => undefined)
		throw err
	}

	return { id }
}
