import { createFileRoute } from '@tanstack/solid-router'
import { z } from 'zod'
import { Sentry } from '@/lib/sentry'
import {
	LISTING_PHOTO_MAX_BYTES,
	LISTING_PHOTO_MIME_TYPES,
	listingPhotoExtensionForMime,
} from '@/lib/listing-photos'

const paramsSchema = z.object({
	id: z.coerce.number().int().positive(),
})

const MAX_PHOTOS_PER_LISTING = 3

export const Route = createFileRoute('/api/listings/$id/photos')({
	server: {
		handlers: {
			async POST({ request, params }) {
				try {
					const { auth } = await import('@/lib/auth.server')
					const session = await auth.api.getSession({
						headers: request.headers,
					})

					if (!session?.user) {
						return Response.json(
							{ error: 'Authentication required' },
							{ status: 401 }
						)
					}

					const parsedParams = paramsSchema.safeParse(params)
					if (!parsedParams.success) {
						return Response.json({ error: 'Invalid listing ID' }, { status: 400 })
					}

					const listingId = parsedParams.data.id
					const { getListingById, getPhotosForListing, addPhotoToListing } =
						await import('@/data/queries.server')

					const listing = await getListingById(listingId)
					if (!listing) {
						return Response.json({ error: 'Not found' }, { status: 404 })
					}
					if (listing.userId !== session.user.id) {
						return Response.json({ error: 'Forbidden' }, { status: 403 })
					}

					const existing = await getPhotosForListing(listingId)
					if (existing.length >= MAX_PHOTOS_PER_LISTING) {
						return Response.json(
							{ error: 'Maximum number of photos reached' },
							{ status: 400 }
						)
					}

					let formData: FormData
					try {
						formData = await request.formData()
					} catch {
						return Response.json(
							{ error: 'Expected multipart form data' },
							{ status: 400 }
						)
					}

					const file = formData.get('photo')
					if (!(file instanceof File)) {
						return Response.json({ error: 'Missing photo file' }, { status: 400 })
					}
					if (file.size === 0) {
						return Response.json({ error: 'Empty file' }, { status: 400 })
					}
					if (file.size > LISTING_PHOTO_MAX_BYTES) {
						return Response.json(
							{ error: 'Photo must be 5 MB or smaller' },
							{ status: 400 }
						)
					}

					const mimeType = file.type
					if (
						!LISTING_PHOTO_MIME_TYPES.includes(
							mimeType as (typeof LISTING_PHOTO_MIME_TYPES)[number]
						)
					) {
						return Response.json(
							{
								error: 'Unsupported image type. Use JPEG, PNG, or WebP.',
							},
							{ status: 400 }
						)
					}

					const ext = listingPhotoExtensionForMime(mimeType)
					if (!ext) {
						return Response.json({ error: 'Unsupported image type' }, { status: 400 })
					}

					const arrayBuffer = await file.arrayBuffer()
					const rawBuffer = Buffer.from(arrayBuffer)

					const sharpModule = await import('sharp')
					// Default sharp pipeline strips EXIF/metadata without `withMetadata()`.
					const cleanBuffer = await sharpModule.default(rawBuffer).toBuffer()

					const fileId = globalThis.crypto.randomUUID()
					const pathWithinDir = `listings/${listingId}/${fileId}${ext}`
					const rawKey = `raw/${pathWithinDir}`

					const { storage } = await import('@/lib/storage.server')
					await storage.upload('raw', pathWithinDir, rawBuffer, {
						mimeType,
					})
					await storage.upload('pub', pathWithinDir, cleanBuffer, {
						mimeType,
					})
					const pubUrl = storage.publicUrl(pathWithinDir)

					const row = await addPhotoToListing(
						listingId,
						rawKey,
						pubUrl,
						existing.length
					)

					return Response.json({ id: row.id, pubUrl: row.pubUrl }, { status: 201 })
				} catch (error) {
					Sentry.withScope((scope) => {
						scope.setTag('handler', 'POST /api/listings/$id/photos')
						Sentry.captureException(error)
					})
					return Response.json({ error: 'Failed to upload photo' }, { status: 500 })
				}
			},
		},
	},
})
