import { Sentry } from '@/lib/sentry'
import { logger } from '@/lib/logger.server'
import {
	INTERNAL_AUTH_HEADER,
	verifyInternalAuth,
	type InternalAuthConfig,
} from '@/lib/internal-auth.server'
import {
	selectNextUser,
	type InternalUsersNextResponse,
} from '@/lib/internal-users-next.server'
import type { RateLimiter } from '@/lib/internal-rate-limit.server'

export interface InternalUsersNextDeps {
	auth: InternalAuthConfig
	limiter: RateLimiter
	loadUser: (cursor: string | null) => Promise<InternalUsersNextResponse>
	now?: () => number
	clientIp?: (request: Request) => string
}

/** Returns a generic 404 so unauthenticated probes can't confirm the route exists. */
function notFound(): Response {
	return new Response('Not Found', {
		status: 404,
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	})
}

function tooManyRequests(retryAfterMs: number): Response {
	const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000)).toString()
	return new Response('Too Many Requests', {
		status: 429,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'retry-after': retryAfter,
		},
	})
}

function defaultClientIp(request: Request): string {
	const xff = request.headers.get('x-forwarded-for')
	if (xff) return xff.split(',')[0].trim()
	const real = request.headers.get('x-real-ip')
	if (real) return real.trim()
	return 'unknown'
}

/**
 * Pure (modulo injected deps) handler for `GET /internal/v1/users/next`.
 *
 * Order of guards: rate limit → auth → DB. Rate-limiting before auth means
 * an attacker that brute-forces the secret still gets throttled. We return
 * 404 on a bad secret instead of 401 so an unauthenticated probe cannot
 * distinguish "endpoint exists" from "endpoint doesn't".
 */
export async function handleInternalUsersNext(
	request: Request,
	deps: InternalUsersNextDeps
): Promise<Response> {
	const clientIp = deps.clientIp ?? defaultClientIp
	const limit = deps.limiter.check(clientIp(request), deps.now?.())
	if (!limit.allowed) {
		return tooManyRequests(limit.retryAfterMs)
	}

	const providedSecret = request.headers.get(INTERNAL_AUTH_HEADER)
	if (!verifyInternalAuth(providedSecret, deps.auth)) {
		return notFound()
	}

	const url = new URL(request.url)
	const cursor = url.searchParams.get('cursor')

	try {
		const started = Date.now()
		const body = await deps.loadUser(cursor)
		logger.debug(
			{
				route: '/internal/v1/users/next',
				status: 200,
				drained: body.user === null,
				durationMs: Date.now() - started,
			},
			'internal: users/next served'
		)
		return Response.json(body)
	} catch (err) {
		Sentry.captureException(err, {
			fingerprint: ['internal-users-next', '5xx'],
		})
		return new Response('Internal Server Error', { status: 500 })
	}
}

export { selectNextUser, INTERNAL_AUTH_HEADER }
