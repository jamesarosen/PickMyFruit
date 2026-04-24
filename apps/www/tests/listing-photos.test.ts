import { describe, it, expect } from 'vitest'
import {
	isLikelyHeicFile,
	LISTING_PHOTO_MAX_BYTES,
	validateListingPhotoFile,
} from '../src/lib/listing-photos'

function makeFile(opts: { name: string; type: string; size?: number }): File {
	const byteLength = opts.size ?? 4
	// File.size reflects the blob's byte length — allocate an ArrayBuffer rather
	// than a large string so tests don't allocate megabytes of content.
	const data = new Uint8Array(byteLength)
	return new File([data], opts.name, { type: opts.type })
}

describe('isLikelyHeicFile', () => {
	it.each([
		{ name: 'IMG_1234.HEIC', type: '' },
		{ name: 'IMG_1234.heic', type: 'image/heic' },
		{ name: 'IMG_1234.heif', type: 'image/heif' },
		{ name: 'photo.heic', type: 'application/octet-stream' },
		{ name: 'photo.HEIF', type: '' },
		{ name: 'burst.heic-sequence', type: 'image/heic-sequence' },
	])('detects HEIC/HEIF: %o', (f) => {
		expect(isLikelyHeicFile(f)).toBe(true)
	})

	it.each([
		{ name: 'photo.jpg', type: 'image/jpeg' },
		{ name: 'photo.png', type: 'image/png' },
		{ name: 'photo.webp', type: 'image/webp' },
		{ name: 'heicpedia.jpg', type: 'image/jpeg' },
	])('passes through supported formats: %o', (f) => {
		expect(isLikelyHeicFile(f)).toBe(false)
	})
})

describe('validateListingPhotoFile', () => {
	it('returns null for a small JPEG', () => {
		expect(
			validateListingPhotoFile(
				makeFile({ name: 'a.jpg', type: 'image/jpeg', size: 1024 })
			)
		).toBeNull()
	})

	it('returns a HEIC-specific message for HEIC files', () => {
		const msg = validateListingPhotoFile(
			makeFile({ name: 'IMG_1234.HEIC', type: '', size: 1024 })
		)
		expect(msg).toMatch(/HEIC/i)
	})

	it('returns a size message for files larger than the limit', () => {
		const msg = validateListingPhotoFile(
			makeFile({
				name: 'big.jpg',
				type: 'image/jpeg',
				size: LISTING_PHOTO_MAX_BYTES + 1,
			})
		)
		expect(msg).toMatch(/5 MB/)
	})

	it('accepts a file exactly at the size limit', () => {
		expect(
			validateListingPhotoFile(
				makeFile({
					name: 'max.jpg',
					type: 'image/jpeg',
					size: LISTING_PHOTO_MAX_BYTES,
				})
			)
		).toBeNull()
	})

	it('prefers the HEIC message over the size message', () => {
		const msg = validateListingPhotoFile(
			makeFile({
				name: 'big.heic',
				type: 'image/heic',
				size: LISTING_PHOTO_MAX_BYTES + 1,
			})
		)
		expect(msg).toMatch(/HEIC/i)
	})
})
