import { createMiddleware } from '@tanstack/solid-start'

function buildCspDirectives(extraImgSrc: string[]): string[] {
	const imgSrc = ["img-src 'self' data: blob:", ...extraImgSrc]
		.filter(Boolean)
		.join(' ')
	return [
		"default-src 'self'",
		// Solid's HydrationScript injects an inline script for SSR hydration.
		// @todo replace 'unsafe-inline' with nonce-based CSP when Solid supports it
		"script-src 'self' 'unsafe-inline'",
		// 'unsafe-inline' is required for Solid JSX style="" attributes and MapLibre GL.
		// If JSX inline styles are moved to CSS classes, 'unsafe-inline' can be dropped and
		// replaced with 'sha256-VQTei97aMH9YclKPQM3e8rL/RXSmj3lPwKVXZgaN2QA=' to whitelist
		// only the static @layer ordering <style> block in RootShell.
		"style-src 'self' 'unsafe-inline'",
		imgSrc,
		"font-src 'self'",
		[
			"connect-src 'self'",
			'https://*.openfreemap.org',
			'https://nominatim.openstreetmap.org',
			'https://photon.komoot.io',
			'https://*.sentry.io',
		].join(' '),
		// MapLibre GL uses blob: URLs for web workers
		"worker-src 'self' blob:",
		"frame-src 'none'",
		"object-src 'none'",
		"base-uri 'self'",
		"frame-ancestors 'none'",
	]
}

/**
 * Applies all security headers to a `Headers` object.
 *
 * `imgSrcHosts` should contain any additional origins (e.g. the Tigris media
 * CDN) that listing photos may be served from. Callers in server contexts
 * typically resolve this from `serverEnv.storage`.
 *
 * Does not include HSTS, which is handled by the TLS middleware (`tls.ts`)
 * alongside HTTP-to-HTTPS and apex-to-www redirects.
 */
export function applySecurityHeaders(
	headers: Headers,
	imgSrcHosts: string[] = []
): void {
	const csp = buildCspDirectives(imgSrcHosts).join('; ')
	headers.set('Content-Security-Policy', csp)
	// Legacy fallback for browsers that predate CSP frame-ancestors
	headers.set('X-Frame-Options', 'DENY')
	headers.set('X-Content-Type-Options', 'nosniff')
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
	// geolocation=(self): the New Listing form asks for the user's position
	// to bias address suggestions (docs/0012-geolocation-location-bias.md).
	headers.set(
		'Permissions-Policy',
		['camera=()', 'microphone=()', 'geolocation=(self)', 'payment=()'].join(', ')
	)
}

// Resolved once on the first request and cached.
let _cspImgSrcHosts: string[] | undefined

/** Sets security response headers on all responses. */
export const securityHeadersMiddleware = createMiddleware().server(
	async ({ next }) => {
		const result = await next()
		if (_cspImgSrcHosts === undefined) {
			const { serverEnv } = await import('@/lib/env.server')
			_cspImgSrcHosts =
				serverEnv.storage.PROVIDER === 'tigris'
					? [serverEnv.storage.mediaOrigin]
					: []
		}
		applySecurityHeaders(result.response.headers, _cspImgSrcHosts)
		return result
	}
)
