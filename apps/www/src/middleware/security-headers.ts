import { createMiddleware } from '@tanstack/solid-start'

const CSP_DIRECTIVES = [
	"default-src 'self'",
	// Solid's HydrationScript injects an inline script for SSR hydration.
	// @todo replace 'unsafe-inline' with nonce-based CSP when Solid supports it
	"script-src 'self' 'unsafe-inline'",
	// Inline styles are used by Solid JSX style attributes and MapLibre GL.
	// @todo investigate whether 'unsafe-inline' can be removed for style-src
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' data: blob:",
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

/**
 * Header name/value pairs applied to every response.
 *
 * Does not include HSTS, which is handled by the TLS middleware (`tls.ts`)
 * alongside HTTP-to-HTTPS and apex-to-www redirects.
 */
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
	['Content-Security-Policy', CSP_DIRECTIVES.join('; ')],
	// Legacy fallback for browsers that predate CSP frame-ancestors
	['X-Frame-Options', 'DENY'],
	['X-Content-Type-Options', 'nosniff'],
	['Referrer-Policy', 'strict-origin-when-cross-origin'],
	[
		'Permissions-Policy',
		['camera=()', 'microphone=()', 'geolocation=()', 'payment=()'].join(', '),
	],
]

/** Applies all security headers to a `Headers` object. */
function applySecurityHeaders(headers: Headers): void {
	for (const [name, value] of SECURITY_HEADERS) {
		headers.set(name, value)
	}
}

/** Sets security response headers on all responses. */
export const securityHeadersMiddleware = createMiddleware().server(
	async ({ next }) => {
		const result = await next()
		applySecurityHeaders(result.response.headers)
		return result
	}
)
