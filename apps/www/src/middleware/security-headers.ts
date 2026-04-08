import { createMiddleware } from '@tanstack/solid-start'
import { serverEnv } from '@/lib/env.server'

// Narrow to the specific bucket hostname when running against Tigris, so a
// compromised or misconfigured sibling bucket cannot be used to exfiltrate data.
const tigrisImgSrc =
	serverEnv.storage.PROVIDER === 'tigris'
		? `https://${serverEnv.storage.BUCKET_NAME}.fly.storage.tigris.dev`
		: null

const CSP_DIRECTIVES = [
	"default-src 'self'",
	// Solid's HydrationScript injects an inline script for SSR hydration.
	// @todo replace 'unsafe-inline' with nonce-based CSP when Solid supports it
	"script-src 'self' 'unsafe-inline'",
	// 'unsafe-inline' is required for Solid JSX style="" attributes and MapLibre GL.
	// If JSX inline styles are moved to CSS classes, 'unsafe-inline' can be dropped and
	// replaced with 'sha256-VQTei97aMH9YclKPQM3e8rL/RXSmj3lPwKVXZgaN2QA=' to whitelist
	// only the static @layer ordering <style> block in RootShell.
	"style-src 'self' 'unsafe-inline'",
	["img-src 'self' data: blob:", tigrisImgSrc].filter(Boolean).join(' '),
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
export function applySecurityHeaders(headers: Headers): void {
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
