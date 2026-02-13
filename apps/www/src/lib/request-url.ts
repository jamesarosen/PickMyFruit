/**
 * Derive the base URL (scheme + host) from request headers.
 * Works behind reverse proxies (Fly.io) that set X-Forwarded-* headers.
 */
export function getRequestBaseUrl(headers: Headers): string {
	const proto = headers.get('x-forwarded-proto') || 'http'
	const host =
		headers.get('x-forwarded-host') || headers.get('host') || 'localhost'
	return `${proto}://${host}`
}
