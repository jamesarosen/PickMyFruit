import { describe, it, expect, vi } from 'vitest'
import {
	createResendContactUpsert,
	parseRetryAfter,
	type ResendContact,
} from '../src/lib/resend-contacts.server'

const CONTACT_ID = 'c1-uuid'
const contact: ResendContact = {
	email: 'alice@example.com',
	name: 'Alice Anderson',
}

function makeFetch(handlers: Array<(req: Request) => Response>) {
	let call = 0
	const calls: Request[] = []
	const fetchImpl = vi.fn((url: string | URL, init: RequestInit = {}) => {
		const headers = new Headers(init.headers as HeadersInit | undefined)
		const req = new Request(url.toString(), {
			method: init.method ?? 'GET',
			headers,
			body: (init.body as BodyInit | null) ?? null,
		})
		calls.push(req)
		const handler = handlers[call]
		call++
		if (!handler) throw new Error(`Unexpected fetch call #${call}`)
		return Promise.resolve(handler(req))
	})
	return { fetchImpl: fetchImpl as unknown as typeof fetch, calls }
}

function makeConfig(fetchImpl: typeof fetch) {
	return {
		apiKey: 'rk_test',
		baseUrl: 'https://api.example.com',
		fetchImpl,
	}
}

describe('createResendContactUpsert', () => {
	it('creates a new contact when GET returns 404', async () => {
		const { fetchImpl, calls } = makeFetch([
			() => new Response('{}', { status: 404 }),
			() => new Response(JSON.stringify({ id: CONTACT_ID }), { status: 200 }),
		])

		const upsert = createResendContactUpsert(makeConfig(fetchImpl))
		const result = await upsert(contact)

		expect(result).toStrictEqual({ kind: 'ok' })
		expect(calls).toHaveLength(2)

		const [getReq, postReq] = calls
		expect(getReq.method).toBe('GET')
		expect(getReq.url).toContain('/contacts/alice%40example.com')

		expect(postReq.method).toBe('POST')
		expect(postReq.url).toMatch(/\/contacts$/)
		const postBody = (await postReq.json()) as Record<string, unknown>
		expect(postBody).toStrictEqual({
			email: 'alice@example.com',
			first_name: 'Alice',
			last_name: 'Anderson',
			unsubscribed: false,
		})
	})

	it('updates an existing contact via PATCH and preserves opt-out state', async () => {
		const { fetchImpl, calls } = makeFetch([
			() => new Response(JSON.stringify({ id: CONTACT_ID }), { status: 200 }),
			() => new Response('{}', { status: 200 }),
		])

		const upsert = createResendContactUpsert(makeConfig(fetchImpl))
		const result = await upsert({ ...contact, name: 'Alice Updated' })

		expect(result).toStrictEqual({ kind: 'ok' })
		const [, patchReq] = calls
		expect(patchReq.method).toBe('PATCH')
		expect(patchReq.url).toContain(`/contacts/${CONTACT_ID}`)
		const patchBody = (await patchReq.json()) as Record<string, unknown>
		expect(patchBody).toStrictEqual({
			first_name: 'Alice',
			last_name: 'Updated',
		})
		// Critical: must not clobber an opt-out done in Resend's dashboard.
		expect(patchBody).not.toHaveProperty('unsubscribed')
	})

	it('returns client-error for 4xx from GET contact', async () => {
		const { fetchImpl } = makeFetch([
			() =>
				new Response('{"message":"invalid email"}', {
					status: 422,
					statusText: 'Unprocessable',
				}),
		])

		const upsert = createResendContactUpsert(makeConfig(fetchImpl))
		const result = await upsert({ ...contact, email: 'not-an-email' })
		expect(result).toStrictEqual({
			kind: 'client-error',
			status: 422,
			message: 'invalid email',
		})
	})

	it('returns server-error with parsed Retry-After for 429', async () => {
		const { fetchImpl } = makeFetch([
			() =>
				new Response('{"message":"rate limited"}', {
					status: 429,
					headers: { 'retry-after': '2' },
				}),
		])

		const upsert = createResendContactUpsert(makeConfig(fetchImpl))
		const result = await upsert(contact)
		expect(result).toStrictEqual({
			kind: 'server-error',
			status: 429,
			message: 'rate limited',
			retryAfterMs: 2_000,
		})
	})

	it('returns network-error when fetch throws', async () => {
		const fetchImpl = vi.fn(() =>
			Promise.reject(new Error('socket reset'))
		) as unknown as typeof fetch
		const upsert = createResendContactUpsert({
			apiKey: 'rk_test',
			baseUrl: 'https://api.example.com',
			fetchImpl,
		})
		const result = await upsert(contact)
		expect(result.kind).toBe('network-error')
	})
})

describe('parseRetryAfter', () => {
	it.each([
		['5', 5_000],
		['0', 0],
		['', null],
		[null, null],
		['nope', null],
	])('%j → %j', (input, expected) => {
		expect(parseRetryAfter(input)).toBe(expected)
	})
})
