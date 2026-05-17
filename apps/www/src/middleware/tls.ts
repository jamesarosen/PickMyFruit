import { createMiddleware } from '@tanstack/solid-start'

const HSTS_HEADER = 'Strict-Transport-Security'
const HSTS_VALUE = 'max-age=31536000; includeSubDomains'
const APEX_DOMAIN = 'pickmyfruit.com'

/** Hostname suffix for Fly's private 6PN network (e.g. `pickmyfruit.flycast`). */
const FLYCAST_SUFFIX = '.flycast'

/**
 * True for the internal `.flycast` host where TLS is not available.
 *
 * **Security note:** `decideTls` consults both `x-forwarded-host` and `url.host`
 * for this check. That is only safe because Fly's edge proxy sets
 * `x-forwarded-host` itself and an external client cannot forge it through Fly.
 * If this app is ever fronted by a different proxy/CDN — or run behind a local
 * dev proxy that passes the header through — an attacker could send
 * `x-forwarded-host: foo.flycast` to disable the HTTPS redirect and suppress
 * HSTS. Re-evaluate this trust assumption before changing the ingress.
 *
 * @see https://fly.io/docs/networking/request-headers/
 */
export function isFlycastHost(host: string | null | undefined): boolean {
	if (!host) return false
	const bare = host.split(':')[0]
	return bare === 'flycast' || bare.endsWith(FLYCAST_SUFFIX)
}

export interface TlsDecision {
	/** Set when the middleware should short-circuit with a redirect Response. */
	redirect?: { status: 307; location: string }
	/** Set when downstream responses should receive the HSTS header. */
	addHstsHeader: boolean
}

/**
 * Decides what the TLS middleware should do for a given request.
 * Pure: relies only on the URL and a few request headers, so it's trivial to test.
 *
 * - Forwarded plain HTTP → redirect to HTTPS (unless `.flycast`)
 * - Apex host → redirect to www (always, even on `.flycast`)
 * - TLS responses get HSTS, unless the host is `.flycast`
 */
export function decideTls(
	requestUrl: string,
	headers: {
		'x-forwarded-proto': string | null
		'x-forwarded-host': string | null
	}
): TlsDecision {
	const url = new URL(requestUrl)
	const forwardedHost = headers['x-forwarded-host']
	const host = forwardedHost ?? url.host
	const isInternalFlycast =
		isFlycastHost(forwardedHost) || isFlycastHost(url.host)

	let needsRedirect = false

	const forwardedProto = headers['x-forwarded-proto']
	const isTLS = forwardedProto === 'https'
	if (forwardedProto && !isTLS && !isInternalFlycast) {
		url.protocol = 'https:'
		needsRedirect = true
	}

	if (host === APEX_DOMAIN) {
		url.host = `www.${APEX_DOMAIN}`
		needsRedirect = true
	}

	const addHstsHeader = isTLS && !isInternalFlycast

	if (needsRedirect) {
		return { redirect: { status: 307, location: url.toString() }, addHstsHeader }
	}
	return { addHstsHeader }
}

/**
 * Security middleware for HTTP redirects and headers.
 *
 * - Redirects HTTP to HTTPS with 307
 * - Redirects apex domain (pickmyfruit.com) to www.pickmyfruit.com with 307
 * - Adds HSTS header for HTTPS connections (1 year, includeSubDomains)
 * - Skips the HTTPS redirect and HSTS for `*.flycast` hosts — Fly's private 6PN
 *   hostname has no TLS certificate, so internal callers reach us over plain
 *   HTTP. HSTS without TLS is meaningless and would poison the browser cache
 *   if anything ever hit it over `https://`.
 *
 * Other security headers (CSP, X-Frame-Options, etc.) are in `security-headers.server.ts`.
 *
 * Note: Fly.io has a force_https feature, but it's limited to a 301 redirect
 * and doesn't handle apex to www redirects, so we handle both here. This also
 * defends against losing the redirect if we switch hosting providers.
 *
 * @todo support a staging apex domain
 * @see https://community.fly.io/t/new-feature-automatic-https-redirects/4442
 * @see https://fly.io/docs/networking/flycast/
 */
export const tlsMiddleware = createMiddleware().server(
	async ({ next, request }) => {
		const decision = decideTls(request.url, {
			'x-forwarded-proto': request.headers.get('x-forwarded-proto'),
			'x-forwarded-host': request.headers.get('x-forwarded-host'),
		})

		if (decision.redirect) {
			const result = new Response(null, {
				status: decision.redirect.status,
				headers: { Location: decision.redirect.location },
			})
			if (decision.addHstsHeader) {
				result.headers.set(HSTS_HEADER, HSTS_VALUE)
			}
			return result
		}

		const result = await next()

		if (decision.addHstsHeader && !result.response.headers.has(HSTS_HEADER)) {
			result.response.headers.set(HSTS_HEADER, HSTS_VALUE)
		}

		return result
	}
)
