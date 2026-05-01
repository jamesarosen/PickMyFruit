import { createMiddleware } from '@tanstack/solid-start'

/** True when the response is likely a full HTML document (not XHTML, not fragments). */
export function responseLooksLikeHtmlDocument(response: Response): boolean {
	const type = response.headers.get('content-type') ?? ''
	if (!type.includes('text/html')) return false
	if (type.includes('text/html+xml')) return false
	return true
}

/**
 * Returns a new Response with `Link: preconnect` to `mediaOrigin`, or the same
 * response if preconnect does not apply.
 */
export function withMediaPreconnectLink(
	response: Response,
	mediaOrigin: string
): Response {
	const linkValue = `<${mediaOrigin}>; rel=preconnect; crossorigin`
	const headers = new Headers(response.headers)
	const existing = headers.get('Link')
	headers.set('Link', existing ? `${existing}, ${linkValue}` : linkValue)
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

/**
 * Adds `Link: <mediaOrigin>; rel=preconnect; crossorigin` on HTML document responses
 * when using Tigris, so the browser warms the media CDN without exposing the origin
 * in the client bundle.
 */
export const mediaPreconnectMiddleware = createMiddleware().server(
	async ({ next }) => {
		const result = await next()
		const { response } = result
		if (
			response.status < 200 ||
			response.status >= 300 ||
			!responseLooksLikeHtmlDocument(response)
		) {
			return result
		}

		const { serverEnv } = await import('@/lib/env.server')
		if (serverEnv.storage.PROVIDER !== 'tigris') return result

		return {
			...result,
			response: withMediaPreconnectLink(response, serverEnv.storage.mediaOrigin),
		}
	}
)
