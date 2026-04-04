import { createServerFn } from '@tanstack/solid-start'
import { getRequestHeaders } from '@tanstack/solid-start/server'
import { z } from 'zod'
import { errorMiddleware, UserError } from '@/lib/server-error-middleware'
import {
	validatePhotoFile,
	uploadListingPhoto,
	mimeToExt,
} from '@/lib/listing-photo-upload.server'

const deletePhotoSchema = z.object({
	photoId: z.number().int().positive(),
})

/**
 * Uploads a photo for a listing.
 *
 * Reads multipart/form-data from the raw request: expects a `listingId`
 * field and a `photo` file field. Returns `{ id, pubUrl }` on success.
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

		// Verify listing ownership before doing file work
		const { getListingById } = await import('@/data/queries.server')
		const listing = await getListingById(listingId)
		if (!listing || listing.userId !== session.user.id) {
			throw new UserError('NOT_FOUND', 'Listing not found')
		}

		const rawBuffer = Buffer.from(await file.arrayBuffer())
		validatePhotoFile(file.type, rawBuffer.byteLength)

		const { getPhotosForListing, addPhotoToListing } =
			await import('@/data/queries.server')
		const existingPhotos = await getPhotosForListing(listingId)

		const { storage } = await import('@/lib/storage.server')
		const { rawKey, pubUrl } = await uploadListingPhoto({
			listingId,
			rawBuffer,
			mimeType: file.type,
			fileExt: mimeToExt(file.type as Parameters<typeof mimeToExt>[0]),
			currentPhotoCount: existingPhotos.length,
			storage,
		})

		const order = existingPhotos.length
		const photo = await addPhotoToListing(listingId, rawKey, pubUrl, order)
		return { id: photo.id, pubUrl: photo.pubUrl }
	})

/**
 * Deletes a listing photo and removes both storage objects.
 *
 * Uses POST (not DELETE) because TanStack Start server functions only support
 * GET and POST. Input: `{ photoId: number }`.
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

		const { storage } = await import('@/lib/storage.server')
		await Promise.all([
			storage.delete('raw', deleted.rawKey),
			storage.delete('pub', deleted.rawKey),
		])

		return { success: true }
	})
