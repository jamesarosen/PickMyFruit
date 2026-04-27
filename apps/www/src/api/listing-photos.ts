import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'
import { MAX_PHOTOS_PER_LISTING } from '@/lib/listing-photos'

const deletePhotoSchema = z.object({
	photoId: z.string().uuid(),
})

/**
 * Uploads a photo for a listing.
 *
 * Expects multipart/form-data with a `listingId` field (number) and a `photo`
 * file field. Returns `{ id, pubUrl }` on success.
 */
export const addPhotoToListing = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data) => {
		if (!(data instanceof FormData)) {
			throw new UserError('INVALID_INPUT', 'Expected multipart form data')
		}
		return data
	})
	.handler(async ({ data: formData }) => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })

		if (!session?.user) {
			throw new UserError('AUTH_REQUIRED', 'Authentication required')
		}

		const listingId = Number(formData.get('listingId'))
		if (!Number.isInteger(listingId) || listingId <= 0) {
			throw new UserError('INVALID_INPUT', 'Invalid listing ID')
		}

		const file = formData.get('photo')
		if (!(file instanceof File)) {
			throw new UserError('INVALID_INPUT', 'A photo file is required')
		}

		// Reject oversized uploads before buffering to avoid OOM on large files.
		// Import the constant from the server module dynamically (*.server modules
		// may not be statically imported per the no-server-static-import lint rule).
		const {
			MAX_FILE_SIZE_BYTES,
			ALLOWED_MIME_TYPES,
			assertPhotoUploadCapacity,
			detectMimeFromTempFile,
			stageUploadStream,
			unlinkUploadStaging,
			uploadListingPhoto,
			mimeToExt,
		} = await import('@/lib/listing-photo-upload.server')
		// Shed load before staging to disk so an overloaded server doesn't
		// keep accepting 5 MB temp files it can't process.
		assertPhotoUploadCapacity()
		if (file.size > MAX_FILE_SIZE_BYTES) {
			throw new UserError('FILE_TOO_LARGE', 'Photo must be 5 MB or smaller')
		}
		// Pre-filter on client-supplied type before buffering — avoids reading the
		// full body for obviously wrong types. The authoritative check (magic bytes)
		// runs after arrayBuffer().
		if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
			throw new UserError(
				'INVALID_MIME_TYPE',
				'Only JPEG, PNG, and WebP images are allowed. iPhone HEIC photos must be converted first.'
			)
		}

		// Verify listing ownership before doing file work
		const { getListingById } = await import('@/data/queries.server')
		const listing = await getListingById(listingId)
		if (!listing || listing.userId !== session.user.id) {
			throw new UserError('NOT_FOUND', 'Listing not found')
		}

		// Stage the upload to disk so the file body never sits in memory as a
		// Buffer. Two read streams are then opened from the temp file: one for
		// the raw archive copy, one for the Sharp-processed public copy.
		const tempPath = await stageUploadStream(
			file.stream() as ReadableStream<Uint8Array>
		)
		try {
			const mimeType = await detectMimeFromTempFile(tempPath)

			const { addPhotoToListing } = await import('@/data/queries.server')

			const fileExt = mimeToExt(mimeType)
			const { storage } = await import('@/lib/storage.server')
			const { id } = await uploadListingPhoto({
				tempPath,
				mimeType,
				fileExt,
				storage,
			})
			const rawPathKey = `listing_photos/${id}${fileExt}`
			const pubPathKey = `listing_photos/${id}.jpg`

			let photo
			try {
				photo = await addPhotoToListing(
					listingId,
					id,
					fileExt,
					MAX_PHOTOS_PER_LISTING
				)
			} catch (dbErr) {
				// The storage objects are now orphaned. Best-effort cleanup — if deletion
				// fails, Sentry will capture it so an ops script can reconcile.
				const { Sentry } = await import('@/lib/sentry')
				await Promise.all([
					storage
						.delete('raw', rawPathKey)
						.catch((e) => Sentry.captureException(e, { extra: { rawPathKey } })),
					storage
						.delete('pub', pubPathKey)
						.catch((e) => Sentry.captureException(e, { extra: { pubPathKey } })),
				])
				throw dbErr
			}

			if (!photo) {
				// addPhotoToListing returns null when the listing is already at the limit.
				// Clean up the storage objects we just uploaded.
				const { Sentry } = await import('@/lib/sentry')
				await Promise.all([
					storage
						.delete('raw', rawPathKey)
						.catch((e) => Sentry.captureException(e, { extra: { rawPathKey } })),
					storage
						.delete('pub', pubPathKey)
						.catch((e) => Sentry.captureException(e, { extra: { pubPathKey } })),
				])
				throw new UserError(
					'TOO_MANY_PHOTOS',
					`A listing can have at most ${MAX_PHOTOS_PER_LISTING} photos`
				)
			}

			return {
				id: photo.id,
				pubUrl: storage.publicUrl(`listing_photos/${photo.id}.jpg`),
			}
		} finally {
			await unlinkUploadStaging(tempPath)
		}
	})

/**
 * Deletes a listing photo and removes both storage objects.
 *
 * Uses POST (not DELETE) because TanStack Start server functions only support
 * GET and POST. Input: `{ photoId: string }`, a valid UUIDv7.
 *
 * @return `{ success: true }`.
 */
export const deletePhoto = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: { photoId: string }) => deletePhotoSchema.parse(data))
	.handler(async ({ data: { photoId } }) => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })

		if (!session?.user) {
			throw new UserError('AUTH_REQUIRED', 'Authentication required')
		}

		const { deleteListingPhoto } = await import('@/data/queries.server')
		const deleted = await deleteListingPhoto(photoId, session.user.id)

		if (!deleted) {
			throw new UserError('NOT_FOUND', 'Photo not found')
		}

		// Attempt storage cleanup. On failure, capture the path to Sentry so it can
		// be reconciled by an ops script — it is no longer reachable from the DB.
		const rawPathKey = `listing_photos/${deleted.id}${deleted.ext}`
		const pubPathKey = `listing_photos/${deleted.id}.jpg`
		const { storage } = await import('@/lib/storage.server')
		const { Sentry } = await import('@/lib/sentry')
		await Promise.all([
			storage
				.delete('raw', rawPathKey)
				.catch((e) => Sentry.captureException(e, { extra: { rawPathKey } })),
			storage
				.delete('pub', pubPathKey)
				.catch((e) => Sentry.captureException(e, { extra: { pubPathKey } })),
		])

		return { success: true }
	})
