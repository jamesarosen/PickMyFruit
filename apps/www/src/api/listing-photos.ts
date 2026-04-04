import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'

const deletePhotoSchema = z.object({
	photoId: z.number().int().positive(),
})

/**
 * Uploads a photo for a listing.
 *
 * Reads multipart/form-data from the raw request: expects a `listingId`
 * field (number) and a `photo` file field. Returns `{ id, pubUrl }` on success.
 *
 * File is not passed through inputValidator (File is not JSON-serializable);
 * the handler reads it directly from the request body.
 */
export const uploadPhoto = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.handler(async () => {
		const headers = getRequestHeaders()
		const { auth } = await import('@/lib/auth.server')
		const session = await auth.api.getSession({ headers })

		if (!session?.user) {
			throw new UserError('AUTH_REQUIRED', 'Authentication required')
		}

		const { getRequest } = await import('@tanstack/solid-start/server')
		const request = await getRequest()
		const formData = await request.formData()

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
			validatePhotoFile,
			uploadListingPhoto,
			mimeToExt,
		} = await import('@/lib/listing-photo-upload.server')
		if (file.size > MAX_FILE_SIZE_BYTES) {
			throw new UserError('FILE_TOO_LARGE', 'Photo must be 5 MB or smaller')
		}

		// Verify listing ownership before doing file work
		const { getListingById } = await import('@/data/queries.server')
		const listing = await getListingById(listingId)
		if (!listing || listing.userId !== session.user.id) {
			throw new UserError('NOT_FOUND', 'Listing not found')
		}

		const rawBuffer = Buffer.from(await file.arrayBuffer())
		// validatePhotoFile returns the narrowed AllowedMimeType, eliminating any cast
		const mimeType = validatePhotoFile(file.type, rawBuffer.byteLength)

		const { getPhotosForListing, addPhotoToListing } =
			await import('@/data/queries.server')
		const existingPhotos = await getPhotosForListing(listingId)

		const { storage } = await import('@/lib/storage.server')
		const { rawKey, pubUrl } = await uploadListingPhoto({
			listingId,
			rawBuffer,
			mimeType,
			fileExt: mimeToExt(mimeType),
			currentPhotoCount: existingPhotos.length,
			storage,
		})

		const order = existingPhotos.length
		let photo
		try {
			photo = await addPhotoToListing(listingId, rawKey, pubUrl, order)
		} catch (dbErr) {
			// The storage objects are now orphaned. Best-effort cleanup — if deletion
			// fails, Sentry will capture it so an ops script can reconcile.
			const { Sentry } = await import('@/lib/sentry')
			await Promise.all([
				storage
					.delete('raw', rawKey)
					.catch((e) => Sentry.captureException(e, { extra: { rawKey } })),
				storage
					.delete('pub', rawKey)
					.catch((e) => Sentry.captureException(e, { extra: { rawKey } })),
			])
			throw dbErr
		}

		return { id: photo.id, pubUrl: photo.pubUrl }
	})

/**
 * Deletes a listing photo and removes both storage objects.
 *
 * Uses POST (not DELETE) because TanStack Start server functions only support
 * GET and POST. Input: `{ photoId: number }`. Returns `{ success: true }`.
 */
export const deletePhoto = createServerFn({ method: 'POST' })
	.middleware([errorMiddleware])
	.inputValidator((data: { photoId: number }) => deletePhotoSchema.parse(data))
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

		// Attempt storage cleanup. On failure, capture the rawKey to Sentry so it can
		// be reconciled by an ops script — it is no longer reachable from the DB.
		const { storage } = await import('@/lib/storage.server')
		const { Sentry } = await import('@/lib/sentry')
		await Promise.all([
			storage
				.delete('raw', deleted.rawKey)
				.catch((e) =>
					Sentry.captureException(e, { extra: { rawKey: deleted.rawKey } })
				),
			storage
				.delete('pub', deleted.rawKey)
				.catch((e) =>
					Sentry.captureException(e, { extra: { rawKey: deleted.rawKey } })
				),
		])

		return { success: true }
	})
