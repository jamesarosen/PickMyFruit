import { createMiddleware } from '@tanstack/solid-start'

const HSTS_HEADER = 'Strict-Transport-Security'
const HSTS_VALUE = 'max-age=31536000; includeSubDomains'
const APEX_DOMAIN = 'pickmyfruit.com'

/**
 * Security middleware for HTTP redirects and headers.
 *
 * - Redirects HTTP to HTTPS with 307
 * - Redirects apex domain (pickmyfruit.com) to www.pickmyfruit.com with 307
 * - Adds HSTS header for HTTPS connections (1 year, includeSubDomains)
 *
 * Note: Fly.io has a force_https feature, but it's limited to a 301 redirect
 * and doesn't handle apex to www redirects, so we handle both here. This also
 * defends against losing the redirect if we switch hosting providers.
 *
 * @todo support a staging apex domain
 * @see https://community.fly.io/t/new-feature-automatic-https-redirects/4442
 */
export const tlsMiddleware = createMiddleware().server(async ({ next, request }) => {
	const url = new URL(request.url)
	let needsRedirect = false

	// Local dev doesn't have a proxy terminating TLS, so we skip TLS logic there
	const forwardedProto = request.headers.get('x-forwarded-proto')
	const isTLS = forwardedProto === 'https'
	if (forwardedProto && !isTLS) {
		url.protocol = 'https:'
		needsRedirect = true
	}

	const host = request.headers.get('x-forwarded-host') ?? url.host
	if (host === APEX_DOMAIN) {
		url.host = `www.${APEX_DOMAIN}`
		needsRedirect = true
	}

	if (needsRedirect) {
		const result = new Response(null, {
			status: 307,
			headers: { Location: url.toString() },
		})
		if (isTLS) {
			result.headers.set(HSTS_HEADER, HSTS_VALUE)
		}
		return result
	}

	const result = await next()

	if (isTLS && !result.response.headers.has(HSTS_HEADER)) {
		result.response.headers.set(HSTS_HEADER, HSTS_VALUE)
	}

	return result
})
