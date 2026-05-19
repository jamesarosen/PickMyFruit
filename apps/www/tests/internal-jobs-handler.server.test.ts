/**
 * Contract + auth tests for /internal/v1/jobs/{claim, :id/complete, :id/fail}.
 *
 * Drives the pure handlers against fake deps so we exercise rate-limit + auth
 * + body validation without spinning up a DB. The DB-backed round-trip is
 * covered separately in jobs.server.test.ts.
 */
import { describe, it, expect, vi } from 'vitest'
import {
	handleClaim,
	handleComplete,
	handleFail,
} from '../src/lib/internal-jobs-handler.server'
import { createRateLimiter } from '../src/lib/internal-rate-limit.server'

vi.mock('../src/lib/sentry', () => ({
	Sentry: { captureException: vi.fn() },
}))
vi.mock('../src/lib/logger.server', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

const CURRENT = 'current-secret-min-32-chars-aaaaaaa'
const PREVIOUS = 'previous-secret-min-32-chars-bbbbbb'

function freshLimiter() {
	return createRateLimiter({ windowMs: 60_000, max: 1_000 })
}

function postRequest(
	url: string,
	body: unknown,
	overrides: { secret?: string | null; ip?: string } = {}
): Request {
	const headers = new Headers({ 'content-type': 'application/json' })
	const secret =
		overrides.secret === undefined ? CURRENT : (overrides.secret ?? '')
	if (secret) headers.set('x-internal-auth', secret)
	headers.set('x-forwarded-for', overrides.ip ?? '203.0.113.7')
	return new Request(url, {
		method: 'POST',
		headers,
		body: JSON.stringify(body),
	})
}

describe('handleClaim', () => {
	it('routes a well-formed claim to the deps and returns {job}', async () => {
		const claim = vi.fn(async () => ({
			id: 'job-1',
			queue: 'resend-email',
			data: '{"type":"noop"}',
			attempts: 0,
		}))
		const res = await handleClaim(
			postRequest('http://pickmyfruit.flycast/internal/v1/jobs/claim', {
				queue: 'resend-email',
				workerId: 'w-1',
				leaseSeconds: 60,
			}),
			{
				auth: { current: CURRENT, previous: PREVIOUS },
				limiter: freshLimiter(),
				claim,
			}
		)
		expect(res.status).toBe(200)
		expect(claim).toHaveBeenCalledOnce()
		expect(await res.json()).toEqual({
			job: {
				id: 'job-1',
				queue: 'resend-email',
				data: '{"type":"noop"}',
				attempts: 0,
			},
		})
	})

	it('returns 404 (not 401) when the auth header is missing', async () => {
		const claim = vi.fn()
		const res = await handleClaim(
			postRequest(
				'http://pickmyfruit.flycast/internal/v1/jobs/claim',
				{ queue: 'resend-email', workerId: 'w-1', leaseSeconds: 60 },
				{ secret: null }
			),
			{
				auth: { current: CURRENT },
				limiter: freshLimiter(),
				claim,
			}
		)
		expect(res.status).toBe(404)
		expect(claim).not.toHaveBeenCalled()
	})

	it('accepts the previous secret during rotation', async () => {
		const claim = vi.fn(async () => null)
		const res = await handleClaim(
			postRequest(
				'http://pickmyfruit.flycast/internal/v1/jobs/claim',
				{ queue: 'resend-email', workerId: 'w-1', leaseSeconds: 60 },
				{ secret: PREVIOUS }
			),
			{
				auth: { current: CURRENT, previous: PREVIOUS },
				limiter: freshLimiter(),
				claim,
			}
		)
		expect(res.status).toBe(200)
	})

	it('returns 400 on a malformed body', async () => {
		const claim = vi.fn()
		const res = await handleClaim(
			postRequest('http://pickmyfruit.flycast/internal/v1/jobs/claim', {
				queue: '',
				workerId: 'w-1',
				leaseSeconds: -5,
			}),
			{
				auth: { current: CURRENT },
				limiter: freshLimiter(),
				claim,
			}
		)
		expect(res.status).toBe(400)
		expect(claim).not.toHaveBeenCalled()
	})

	it('rate-limits per IP before checking the secret', async () => {
		const limiter = createRateLimiter({ windowMs: 60_000, max: 1 })
		const claim = vi.fn(async () => null)
		const first = await handleClaim(
			postRequest(
				'http://pickmyfruit.flycast/internal/v1/jobs/claim',
				{ queue: 'resend-email', workerId: 'w-1', leaseSeconds: 60 },
				{ ip: '198.51.100.5' }
			),
			{ auth: { current: CURRENT }, limiter, claim }
		)
		expect(first.status).toBe(200)
		const blocked = await handleClaim(
			postRequest(
				'http://pickmyfruit.flycast/internal/v1/jobs/claim',
				{ queue: 'resend-email', workerId: 'w-1', leaseSeconds: 60 },
				{ ip: '198.51.100.5', secret: 'wrong' }
			),
			{ auth: { current: CURRENT }, limiter, claim }
		)
		expect(blocked.status).toBe(429)
	})
})

describe('handleComplete', () => {
	it('passes the id through and returns {ok}', async () => {
		const complete = vi.fn(async () => true)
		const res = await handleComplete(
			postRequest('http://pickmyfruit.flycast/internal/v1/jobs/job-1/complete', {
				workerId: 'w-1',
			}),
			'job-1',
			{
				auth: { current: CURRENT },
				limiter: freshLimiter(),
				complete,
			}
		)
		expect(res.status).toBe(200)
		expect(complete).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'job-1', workerId: 'w-1' })
		)
		expect(await res.json()).toEqual({ ok: true })
	})

	it('rejects with 400 when workerId is missing', async () => {
		const complete = vi.fn()
		const res = await handleComplete(
			postRequest(
				'http://pickmyfruit.flycast/internal/v1/jobs/job-1/complete',
				{}
			),
			'job-1',
			{
				auth: { current: CURRENT },
				limiter: freshLimiter(),
				complete,
			}
		)
		expect(res.status).toBe(400)
		expect(complete).not.toHaveBeenCalled()
	})
})

describe('handleFail', () => {
	it('forwards retryInSeconds when provided', async () => {
		const fail = vi.fn(async () => true)
		const res = await handleFail(
			postRequest('http://pickmyfruit.flycast/internal/v1/jobs/job-1/fail', {
				workerId: 'w-1',
				error: 'Resend 503',
				retryInSeconds: 30,
			}),
			'job-1',
			{
				auth: { current: CURRENT },
				limiter: freshLimiter(),
				fail,
			}
		)
		expect(res.status).toBe(200)
		expect(fail).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'job-1',
				workerId: 'w-1',
				error: 'Resend 503',
				retryInSeconds: 30,
			})
		)
	})

	it('omits retryInSeconds for a permanent failure', async () => {
		const fail = vi.fn(async () => true)
		await handleFail(
			postRequest('http://pickmyfruit.flycast/internal/v1/jobs/job-1/fail', {
				workerId: 'w-1',
				error: 'schema-mismatch',
			}),
			'job-1',
			{
				auth: { current: CURRENT },
				limiter: freshLimiter(),
				fail,
			}
		)
		expect(fail).toHaveBeenCalledWith(
			expect.objectContaining({ retryInSeconds: undefined })
		)
	})
})
