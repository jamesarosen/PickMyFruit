import { randomUUID } from 'node:crypto'
import type { StorageAdapter } from '@/lib/storage.server'
import { UserError } from '@/lib/user-error'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number]

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024
const MAX_PHOTOS_PER_LISTING = 3

const MIME_TO_EXT: Record<AllowedMimeType, string> = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
}

/**
 * Validates that a file is an allowed image type and within the size limit.
 * Throws a UserError if invalid.
 */
export function validatePhotoFile(mimeType: string, byteLength: number): void {
	if (!ALLOWED_MIME_TYPES.includes(mimeType as AllowedMimeType)) {
		throw new UserError(
			'INVALID_MIME_TYPE',
			'Only JPEG, PNG, and WebP images are allowed'
		)
	}
	if (byteLength > MAX_FILE_SIZE_BYTES) {
		throw new UserError('FILE_TOO_LARGE', 'Photo must be 5 MB or smaller')
	}
}

/** Returns the file extension for an allowed MIME type. */
export function mimeToExt(mimeType: AllowedMimeType): string {
	return MIME_TO_EXT[mimeType]
}

/**
 * Uploads a photo to both raw/ (private, full EXIF) and pub/ (public, EXIF-stripped)
 * storage, and returns the storage key and public URL.
 *
 * Throws a UserError if the listing already has the maximum number of photos.
 */
export async function uploadListingPhoto(opts: {
	listingId: number
	rawBuffer: Buffer
	mimeType: string
	fileExt: string
	currentPhotoCount: number
	storage: StorageAdapter
}): Promise<{ rawKey: string; pubUrl: string }> {
	if (opts.currentPhotoCount >= MAX_PHOTOS_PER_LISTING) {
		throw new UserError(
			'TOO_MANY_PHOTOS',
			`A listing can have at most ${MAX_PHOTOS_PER_LISTING} photos`
		)
	}

	const pathKey = `listings/${opts.listingId}/${randomUUID()}${opts.fileExt}`

	// Store original with full EXIF intact — private, server-side only
	await opts.storage.upload('raw', pathKey, opts.rawBuffer, {
		mimeType: opts.mimeType,
	})

	// Strip EXIF before serving publicly — sharp is a Node-only native dep
	const sharp = (await import('sharp')).default
	const cleanBuffer = await sharp(opts.rawBuffer).withMetadata(false).toBuffer()

	// Public copy served from CDN
	await opts.storage.upload('pub', pathKey, cleanBuffer, {
		mimeType: opts.mimeType,
	})

	return {
		rawKey: pathKey,
		pubUrl: opts.storage.publicUrl(pathKey),
	}
}
