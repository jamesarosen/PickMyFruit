import { z } from 'zod'
import { Sentry } from '@/lib/sentry'
import { logger } from '@/lib/logger.server'
import {
	INTERNAL_AUTH_HEADER,
	verifyInternalAuth,
	type InternalAuthConfig,
} from '@/lib/internal-auth.server'
import type { RateLimiter } from '@/lib/internal-rate-limit.server'
import type {
	ClaimedJob,
	ClaimJobInput,
	CompleteJobInput,
	FailJobInput,
} from '@/data/jobs.server'

/**
 * Pure handlers for the internal `/jobs/*` endpoints. The TanStack route
 * shells dynamically import this module so the server graph stays out of the
 * client bundle. Auth / rate-limit / scrubbing mirrors `/users/next`.
 */

export interface JobsHandlerDepsBase {
	auth: InternalAuthConfig
	limiter: RateLimiter
	now?: () => number
	clientIp?: (request: Request) => string
}

export interface ClaimDeps extends JobsHandlerDepsBase {
	claim: (input: ClaimJobInput) => Promise<ClaimedJob | null>
}

export interface CompleteDeps extends JobsHandlerDepsBase {
	complete: (input: CompleteJobInput) => Promise<boolean>
}

export interface FailDeps extends JobsHandlerDepsBase {
	fail: (input: FailJobInput) => Promise<boolean>
}

const claimBodySchema = z.object({
	queue: z.string().min(1),
	workerId: z.string().min(1),
	leaseSeconds: z.number().int().positive().max(3600),
})

const completeBodySchema = z.object({
	workerId: z.string().min(1),
})

const failBodySchema = z.object({
	workerId: z.string().min(1),
	error: z.string().min(1).max(2000),
	retryInSeconds: z.number().int().nonnegative().max(86_400).optional(),
})

function notFound(): Response {
	return new Response('Not Found', {
		status: 404,
		headers: { 'content-type': 'text/plain; charset=utf-8' },
	})
}

function badRequest(message: string): Response {
	return new Response(message, {
		status: 400,
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

async function guard(
	request: Request,
	deps: JobsHandlerDepsBase
): Promise<Response | null> {
	const clientIp = deps.clientIp ?? defaultClientIp
	const limit = deps.limiter.check(clientIp(request), deps.now?.())
	if (!limit.allowed) return tooManyRequests(limit.retryAfterMs)
	const provided = request.headers.get(INTERNAL_AUTH_HEADER)
	if (!verifyInternalAuth(provided, deps.auth)) return notFound()
	return null
}

async function parseJson<T>(
	request: Request,
	schema: z.ZodType<T>
): Promise<{ ok: true; value: T } | { ok: false; response: Response }> {
	let raw: unknown
	try {
		raw = await request.json()
	} catch {
		return { ok: false, response: badRequest('Invalid JSON') }
	}
	const parsed = schema.safeParse(raw)
	if (!parsed.success) {
		return {
			ok: false,
			response: badRequest(
				parsed.error.issues
					.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
					.join('; ')
			),
		}
	}
	return { ok: true, value: parsed.data }
}

/** `POST /internal/v1/jobs/claim` — returns the next available job or `{job: null}`. */
export async function handleClaim(
	request: Request,
	deps: ClaimDeps
): Promise<Response> {
	const blocked = await guard(request, deps)
	if (blocked) return blocked

	const parsed = await parseJson(request, claimBodySchema)
	if (!parsed.ok) return parsed.response

	try {
		const started = Date.now()
		const job = await deps.claim({
			queue: parsed.value.queue,
			workerId: parsed.value.workerId,
			leaseSeconds: parsed.value.leaseSeconds,
			now: deps.now,
		})
		logger.debug(
			{
				route: '/internal/v1/jobs/claim',
				queue: parsed.value.queue,
				claimed: job !== null,
				durationMs: Date.now() - started,
			},
			'internal: jobs/claim served'
		)
		return Response.json({ job })
	} catch (err) {
		Sentry.captureException(err, { fingerprint: ['internal-jobs', 'claim-5xx'] })
		return new Response('Internal Server Error', { status: 500 })
	}
}

/** `POST /internal/v1/jobs/:id/complete`. */
export async function handleComplete(
	request: Request,
	id: string,
	deps: CompleteDeps
): Promise<Response> {
	const blocked = await guard(request, deps)
	if (blocked) return blocked

	const parsed = await parseJson(request, completeBodySchema)
	if (!parsed.ok) return parsed.response

	try {
		const ok = await deps.complete({
			id,
			workerId: parsed.value.workerId,
			now: deps.now,
		})
		return Response.json({ ok })
	} catch (err) {
		Sentry.captureException(err, {
			fingerprint: ['internal-jobs', 'complete-5xx'],
		})
		return new Response('Internal Server Error', { status: 500 })
	}
}

/** `POST /internal/v1/jobs/:id/fail`. */
export async function handleFail(
	request: Request,
	id: string,
	deps: FailDeps
): Promise<Response> {
	const blocked = await guard(request, deps)
	if (blocked) return blocked

	const parsed = await parseJson(request, failBodySchema)
	if (!parsed.ok) return parsed.response

	try {
		const ok = await deps.fail({
			id,
			workerId: parsed.value.workerId,
			error: parsed.value.error,
			retryInSeconds: parsed.value.retryInSeconds,
			now: deps.now,
		})
		return Response.json({ ok })
	} catch (err) {
		Sentry.captureException(err, { fingerprint: ['internal-jobs', 'fail-5xx'] })
		return new Response('Internal Server Error', { status: 500 })
	}
}
