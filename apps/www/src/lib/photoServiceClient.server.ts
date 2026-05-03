/**
 * Thin fetch client for the photos transform service.
 *
 * PHOTOS_BASE_URL: http://pickmyfruit.flycast:8080 in prod (Fly Flycast internal network)
 * INTERNAL_TOKEN: shared secret, sent as x-internal-token header
 *
 * Default timeout is 60 s — the photos service P99 transform time.
 */

/** Response shape returned by POST /transform/:photoID. */
export interface TransformResult {
	key: string
	width: number | null
	height: number | null
	bytes: number | null
	etag: string | null
	cached: boolean
	coldStart: boolean
	bootMs: number
}

/** Thrown when the photos service returns a non-2xx response. */
export class PhotoServiceError extends Error {
	constructor(
		public readonly status: number,
		public readonly body: string
	) {
		// Keep body as a separate property only — never embed it in the message
		// so internal S3/service details don't leak into error reports.
		super(`Photo service error ${status}`)
		this.name = 'PhotoServiceError'
	}
}

/**
 * Sends a raw image body to `POST /transform/:photoID` on the photos service.
 * On 200, returns the parsed JSON transform result.
 * On non-2xx, throws a `PhotoServiceError`.
 */
export async function transformPhoto(
	photoID: string,
	body: ReadableStream | Blob,
	contentType: string,
	contentLength: number,
	options?: { traceparent?: string; signal?: AbortSignal }
): Promise<TransformResult> {
	const { serverEnv } = await import('@/lib/env.server')

	const headers: Record<string, string> = {
		'Content-Type': contentType,
		'Content-Length': String(contentLength),
		'x-internal-token': serverEnv.INTERNAL_TOKEN,
	}
	if (options?.traceparent) {
		headers['traceparent'] = options.traceparent
	}

	const response = await fetch(
		`${serverEnv.PHOTOS_BASE_URL}/transform/${photoID}`,
		{
			method: 'POST',
			headers,
			body,
			signal: options?.signal,
			// Disable body decompression so the raw bytes reach the service.
			// @ts-expect-error — duplex required for streaming request bodies in Node 18+
			duplex: 'half',
		}
	)

	const text = await response.text()
	if (!response.ok) {
		throw new PhotoServiceError(response.status, text)
	}

	return JSON.parse(text) as TransformResult
}

/**
 * Sends a `HEAD /photos/:photoID` request to the photos service.
 * Returns `{ exists: true }` on 200, `{ exists: false }` on 404.
 * Throws a `PhotoServiceError` on other non-2xx responses.
 */
export async function headPhoto(
	photoID: string,
	options?: { signal?: AbortSignal }
): Promise<{ exists: boolean }> {
	const { serverEnv } = await import('@/lib/env.server')

	const response = await fetch(
		`${serverEnv.PHOTOS_BASE_URL}/photos/${photoID}`,
		{
			method: 'HEAD',
			headers: {
				'x-internal-token': serverEnv.INTERNAL_TOKEN,
			},
			signal: options?.signal,
		}
	)

	if (response.status === 200) return { exists: true }
	if (response.status === 404) return { exists: false }

	throw new PhotoServiceError(response.status, '')
}
