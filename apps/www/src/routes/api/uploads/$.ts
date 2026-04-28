import { Sentry } from '@/lib/sentry'
import { createFileRoute } from '@tanstack/solid-router'

const MIME_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
}

/** Serves public uploads for the local storage adapter (development only). */
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

				// Listing photos are intentionally world-readable — no auth check needed here.
				const pathWithinDir = key.slice('pub/'.length)
				const { storage } = await import('@/lib/storage.server')
				let body: ReadableStream
				try {
					body = await storage.readWebStream('pub', pathWithinDir)
				} catch (err) {
					// Only a missing file is a 404; other I/O errors (permissions, disk-full) are 500.
					if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
						return new Response(null, { status: 404 })
					}
					Sentry.captureException(err)
					return new Response(null, { status: 500 })
				}

				const ext = key.split('.').pop()?.toLowerCase() ?? ''
				const contentType = MIME_TYPES[ext] ?? 'application/octet-stream'
				return new Response(body, {
					headers: {
						'Content-Type': contentType,
						'Content-Disposition': 'inline',
					},
				})
			},
		},
	},
})
