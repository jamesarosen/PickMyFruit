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

// Resolved once on the first request and cached; avoids a static import of a
// *.server module from this non-server file while still paying the import cost
// only once.
let _cspImgSrcHosts: string[] | undefined

/** Hosts allowed in `img-src` for listing photos (Tigris bucket CDN and optional custom origin). */
async function resolveListingImageOriginsForCsp(): Promise<string[]> {
	if (_cspImgSrcHosts === undefined) {
		const { serverEnv } = await import('@/lib/env.server')
		const hosts: string[] = []
		if (serverEnv.storage.PROVIDER === 'tigris') {
			hosts.push(serverEnv.storage.mediaOrigin)
		}
		_cspImgSrcHosts = hosts
	}
	return _cspImgSrcHosts
}

/**
 * Applies all security headers to a `Headers` object.
 *
 * Does not include HSTS, which is handled by the TLS middleware (`tls.ts`)
 * alongside HTTP-to-HTTPS and apex-to-www redirects.
 */
export async function applySecurityHeaders(headers: Headers): Promise<void> {
	const imgSrcHosts = await resolveListingImageOriginsForCsp()
	const csp = buildCspDirectives(imgSrcHosts).join('; ')
	headers.set('Content-Security-Policy', csp)
	// Legacy fallback for browsers that predate CSP frame-ancestors
	headers.set('X-Frame-Options', 'DENY')
	headers.set('X-Content-Type-Options', 'nosniff')
	headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
	headers.set(
		'Permissions-Policy',
		['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].join(', ')
	)
}

/** Sets security response headers on all responses. */
export const securityHeadersMiddleware = createMiddleware().server(
	async ({ next }) => {
		const result = await next()
		await applySecurityHeaders(result.response.headers)
		return result
	}
)
