import { Sentry } from '@/lib/sentry'
import { createFileRoute } from '@tanstack/solid-router'

/**
 * Serves public uploads for the local storage adapter (development only).
 *
 * The URL deliberately omits the file extension. Nitro's dev static-asset
 * handler intercepts paths with image extensions before route matching, so
 * a URL like `/api/uploads/pub/listing_photos/<id>.jpg` short-circuits to a
 * 404 without ever reaching this handler. Public listing photos are always
 * stored as JPEG (`uploadListingPhotoLocked` writes `<id>.jpg`), so the
 * route appends `.jpg` to locate the file on disk.
 */
export const Route = createFileRoute('/api/uploads/$')({
	server: {
		handlers: {
			async GET({ request }) {
				const { serverEnv } = await import('@/lib/env.server')
				if (serverEnv.storage.PROVIDER !== 'local') {
					// In production, env validation requires STORAGE_PROVIDER=tigris, so this
					// route never runs in production. Defense-in-depth: return 404 anyway.
					return new Response(null, { status: 404 })
				}

				const url = new URL(request.url)
				const key = url.pathname.replace(/^\/api\/uploads\//, '')

				// Never serve raw/ (private) objects over HTTP.
				if (!key.startsWith('pub/')) {
					return new Response(null, { status: 404 })
				}

				const pathWithinDir = `${key.slice('pub/'.length)}.jpg`
				const { storage } = await import('@/lib/storage.server')
				let body: ReadableStream
				try {
					body = await storage.readWebStream('pub', pathWithinDir)
				} catch (err) {
					if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
						return new Response(null, { status: 404 })
					}
					Sentry.captureException(err)
					return new Response(null, { status: 500 })
				}

				return new Response(body, {
					headers: {
						'Content-Type': 'image/jpeg',
						'Content-Disposition': 'inline',
					},
				})
			},
		},
	},
})
