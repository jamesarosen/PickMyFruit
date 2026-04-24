/** MIME types accepted for listing photo uploads (matches server validation). */
export const LISTING_PHOTO_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const

export type ListingPhotoMimeType = (typeof LISTING_PHOTO_MIME_TYPES)[number]

/** Maximum number of photos allowed per listing. */
export const MAX_PHOTOS_PER_LISTING = 3

/** Maximum upload size for a single listing photo (5 MB). */
export const LISTING_PHOTO_MAX_BYTES = 5 * 1024 * 1024

/**
 * HTML `accept` attribute value for listing photo file inputs. Limited to
 * supported MIME types — crucially, we do NOT include `image/heic` or
 * `image/heif`. On iOS, when a file input's `accept` list contains only
 * JPEG/PNG/WebP, Safari's photo picker transcodes the selected photo to JPEG
 * automatically, so HEIC never reaches us. If we added `image/heic` here the
 * picker would keep the original HEIC (which we can't decode without a paid
 * license). See: https://bugs.webkit.org/show_bug.cgi?id=(WebKit photo picker).
 */
export const LISTING_PHOTO_ACCEPT = LISTING_PHOTO_MIME_TYPES.join(',')

/** File extension (with dot) for a supported listing photo MIME type, or null. */
export function listingPhotoExtensionForMime(
	mime: string
): '.jpg' | '.png' | '.webp' | null {
	switch (mime) {
		case 'image/jpeg':
			return '.jpg'
		case 'image/png':
			return '.png'
		case 'image/webp':
			return '.webp'
		default:
			return null
	}
}

/**
 * Validates a file chosen by the user before upload. Returns a user-facing
 * error message if the file is rejected, or null if it is acceptable.
 *
 * This is a client-side pre-check that mirrors the server's checks. Its
 * purpose is UX: catching obvious problems (HEIC photos, oversized files)
 * locally gives a clear error instead of making the user wait for a round
 * trip — and avoids hitting edge-level request limits that can produce
 * opaque proxy errors.
 */
export function validateListingPhotoFile(file: File): string | null {
	if (isLikelyHeicFile(file)) {
		return 'HEIC photos (from iPhone) aren’t supported. In your iPhone Settings → Camera → Formats, choose “Most Compatible” and take a new photo, or export this one as JPEG first.'
	}
	if (file.size > LISTING_PHOTO_MAX_BYTES) {
		return 'Photo must be 5 MB or smaller. Try a lower-resolution version.'
	}
	return null
}

/**
 * Heuristically detects HEIC/HEIF files by MIME type and extension. iOS Safari
 * sometimes reports an empty `type` for HEIC files, so the extension check
 * is the primary signal.
 */
export function isLikelyHeicFile(file: {
	name: string
	type: string
}): boolean {
	const type = file.type.toLowerCase()
	if (type === 'image/heic' || type === 'image/heif') return true
	if (type === 'image/heic-sequence' || type === 'image/heif-sequence')
		return true
	const lowerName = file.name.toLowerCase()
	return /\.(heic|heif)$/.test(lowerName)
}
