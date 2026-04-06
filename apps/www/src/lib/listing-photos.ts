/** MIME types accepted for listing photo uploads (matches server validation). */
export const LISTING_PHOTO_MIME_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
] as const

export type ListingPhotoMimeType = (typeof LISTING_PHOTO_MIME_TYPES)[number]

/** Maximum upload size for a single listing photo (5 MB). */
export const LISTING_PHOTO_MAX_BYTES = 5 * 1024 * 1024

/**
 * HTML `accept` attribute value for listing photo file inputs — only supported
 * image MIME types.
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
