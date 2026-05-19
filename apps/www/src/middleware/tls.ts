import { createMiddleware } from '@tanstack/solid-start'

const HSTS_HEADER = 'Strict-Transport-Security'
const HSTS_VALUE = 'max-age=31536000; includeSubDomains'
const APEX_DOMAIN = 'pickmyfruit.com'

export interface TlsDecision {
	/** Set when the middleware should short-circuit with a redirect Response. */
	redirect?: { status: 307; location: string }
	/** Set when downstream responses should receive the HSTS header. */
	addHstsHeader: boolean
}

/**
 * Decides what the TLS middleware should do for a given request. Pure: takes a
 * pre-computed `isInternal` flag (Fly-Src verification happens in the
 * middleware) so this function stays trivial to unit-test.
 *
 * - Forwarded plain HTTP → redirect to HTTPS (unless `isInternal`).
 * - Apex host → redirect to www (always, even on internal traffic).
 * - TLS responses get HSTS, unless `isInternal`.
 */
export function decideTls(
	requestUrl: string,
	headers: {
		'x-forwarded-proto': string | null
		'x-forwarded-host': string | null
	},
	isInternal: boolean
): TlsDecision {
	const url = new URL(requestUrl)
	const host = headers['x-forwarded-host'] ?? url.host

	let needsRedirect = false

	const forwardedProto = headers['x-forwarded-proto']
	const isTLS = forwardedProto === 'https'
	if (forwardedProto && !isTLS && !isInternal) {
		url.protocol = 'https:'
		needsRedirect = true
	}

	if (host === APEX_DOMAIN) {
		url.host = `www.${APEX_DOMAIN}`
		needsRedirect = true
	}

	const addHstsHeader = isTLS && !isInternal

	if (needsRedirect)
		return { redirect: { status: 307, location: url.toString() }, addHstsHeader }
	return { addHstsHeader }
}

/**
 * Security middleware for HTTP redirects and headers.
 *
 * - Redirects HTTP to HTTPS with 307.
 * - Redirects the apex domain (pickmyfruit.com) to www.pickmyfruit.com.
 * - Adds HSTS on HTTPS responses (1 year, includeSubDomains).
 * - Skips the HTTPS redirect and HSTS when the request carries a valid
 *   `Fly-Src` signed by the Ed25519 key Fly mounts at `/.fly/fly-src.pub`.
 *   That proves the request came from another Machine in our org over Fly's
 *   private 6PN (the `.flycast` hostname has no TLS cert). Public requests
 *   never carry a verifiable `Fly-Src`, so they cannot bypass the redirect.
 *
 * Other security headers (CSP, X-Frame-Options, etc.) are in `security-headers.server.ts`.
 *
 * Note: Fly.io has a force_https feature, but it's limited to a 301 redirect
 * and doesn't handle apex-to-www, so we handle both here. This also defends
 * against losing the redirect if we switch hosting providers.
 *
 * @todo support a staging apex domain
 * @see https://community.fly.io/t/new-feature-automatic-https-redirects/4442
 * @see https://community.fly.io/t/detect-public-vs-private-connection/20971
 * @see https://community.fly.io/t/fly-src-authenticating-http-requests-between-fly-apps/20566
 */
export const tlsMiddleware = createMiddleware().server(
	async ({ next, request }) => {
		const { isFlyInternalRequest } =
			await import('@/lib/is-fly-internal-request.server')
		const isInternal = await isFlyInternalRequest(
			{
				'fly-src': request.headers.get('fly-src'),
				'fly-src-signature': request.headers.get('fly-src-signature'),
			},
			{ appName: process.env.FLY_APP_NAME }
		)

		const decision = decideTls(
			request.url,
			{
				'x-forwarded-proto': request.headers.get('x-forwarded-proto'),
				'x-forwarded-host': request.headers.get('x-forwarded-host'),
			},
			isInternal
		)

		if (decision.redirect) {
			const result = new Response(null, {
				status: decision.redirect.status,
				headers: { Location: decision.redirect.location },
			})
			if (decision.addHstsHeader) result.headers.set(HSTS_HEADER, HSTS_VALUE)
			return result
		}

		const result = await next()

		if (decision.addHstsHeader && !result.response.headers.has(HSTS_HEADER))
			result.response.headers.set(HSTS_HEADER, HSTS_VALUE)

		return result
	}
)
