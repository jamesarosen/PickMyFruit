import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { createResendSyncClient } from '../src/lib/resend-sync-client.server'

const AUDIENCE_ID = 'audience-test-123'
const API_KEY = 're_test_key'
const RESEND_BASE_URL = 'https://api.resend.com'
const contactsBaseUrl = `${RESEND_BASE_URL}/audiences/${AUDIENCE_ID}/contacts`
const contactUrl = (email: string) => `${contactsBaseUrl}/${email}`

function makeContact(
	overrides: Partial<{ name: string; email: string; phone: string | null }> = {}
) {
	return {
		id: faker.string.uuid(),
		email: faker.internet.email(),
		name: faker.person.fullName(),
		phone: null,
		...overrides,
	}
}

/** Mocks fetch with one or more sequential responses. */
function mockFetchSequence(
	responses: Array<{ status: number; body: unknown }>
): ReturnType<typeof vi.fn> {
	const fn = vi.fn()
	for (const r of responses) {
		fn.mockResolvedValueOnce(
			new Response(JSON.stringify(r.body), {
				status: r.status,
				headers: { 'Content-Type': 'application/json' },
			})
		)
	}
	return fn
}

function getOk(email = faker.internet.email()) {
	return {
		status: 200,
		body: {
			id: faker.string.uuid(),
			email,
			first_name: 'X',
			last_name: 'Y',
			unsubscribed: false,
		},
	}
}

function getNotFound() {
	return {
		status: 404,
		body: {
			statusCode: 404,
			name: 'not_found',
			message: 'Contact not found',
		},
	}
}

function writeOk() {
	return { status: 200, body: { id: faker.string.uuid() } }
}

describe('createResendSyncClient', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	describe('update path (existing contact)', () => {
		beforeEach(() => {
			vi.stubGlobal('fetch', mockFetchSequence([getOk(), writeOk()]))
		})

		it('GETs the contact then PATCHes it', async () => {
			const contact = makeContact({ email: 'jane@example.com' })
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(contact)

			expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
			const [getUrl, getOptions] = vi.mocked(fetch).mock.calls[0]
			const [patchUrl, patchOptions] = vi.mocked(fetch).mock.calls[1]
			expect(getUrl).toBe(contactUrl('jane@example.com'))
			expect((getOptions as RequestInit).method).toBe('GET')
			expect(patchUrl).toBe(contactUrl('jane@example.com'))
			expect((patchOptions as RequestInit).method).toBe('PATCH')
		})

		it('sends first_name and last_name in the PATCH body', async () => {
			const contact = makeContact({ name: 'Jane Doe' })
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(contact)
			const [, patchOptions] = vi.mocked(fetch).mock.calls[1]
			const body = JSON.parse((patchOptions as RequestInit).body as string)
			expect(body.first_name).toBe('Jane')
			expect(body.last_name).toBe('Doe')
		})

		it('omits unsubscribed from the PATCH body so opt-outs are preserved', async () => {
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(makeContact())
			const [, patchOptions] = vi.mocked(fetch).mock.calls[1]
			const body = JSON.parse((patchOptions as RequestInit).body as string)
			expect(body).not.toHaveProperty('unsubscribed')
		})

		it('returns { kind: "ok" } on a 200 PATCH', async () => {
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result).toEqual({ kind: 'ok' })
		})
	})

	describe('create path (new contact)', () => {
		it('GETs then POSTs after a 404', async () => {
			vi.stubGlobal('fetch', mockFetchSequence([getNotFound(), writeOk()]))
			const contact = makeContact({ email: 'new@example.com' })
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(contact)

			expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2)
			const [getUrl, getOptions] = vi.mocked(fetch).mock.calls[0]
			const [postUrl, postOptions] = vi.mocked(fetch).mock.calls[1]
			expect(getUrl).toBe(contactUrl('new@example.com'))
			expect((getOptions as RequestInit).method).toBe('GET')
			expect(postUrl).toBe(contactsBaseUrl)
			expect((postOptions as RequestInit).method).toBe('POST')
			expect(result).toEqual({ kind: 'ok' })
		})

		it('sends unsubscribed: false on the POST so new contacts default subscribed', async () => {
			vi.stubGlobal('fetch', mockFetchSequence([getNotFound(), writeOk()]))
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(makeContact())
			const [, postOptions] = vi.mocked(fetch).mock.calls[1]
			const body = JSON.parse((postOptions as RequestInit).body as string)
			expect(body.unsubscribed).toBe(false)
		})

		it('returns client-error if the POST fails with 4xx', async () => {
			vi.stubGlobal(
				'fetch',
				mockFetchSequence([
					getNotFound(),
					{
						status: 422,
						body: {
							statusCode: 422,
							name: 'validation_error',
							message: 'Invalid email',
						},
					},
				])
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result).toMatchObject({
				kind: 'client-error',
				status: 422,
				message: 'Invalid email',
			})
		})

		it('returns server-error if the POST fails with 5xx', async () => {
			vi.stubGlobal(
				'fetch',
				mockFetchSequence([
					getNotFound(),
					{
						status: 503,
						body: {
							statusCode: 503,
							name: 'application_error',
							message: 'Service unavailable',
						},
					},
				])
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result).toMatchObject({ kind: 'server-error', status: 503 })
		})
	})

	describe('GET error handling', () => {
		it('returns client-error on a 4xx GET (non-404) without writing', async () => {
			vi.stubGlobal(
				'fetch',
				mockFetchSequence([
					{
						status: 401,
						body: {
							statusCode: 401,
							name: 'authentication_error',
							message: 'Invalid API key',
						},
					},
				])
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
			expect(result).toMatchObject({ kind: 'client-error', status: 401 })
		})

		it('returns server-error on a 5xx GET without writing', async () => {
			vi.stubGlobal(
				'fetch',
				mockFetchSequence([
					{
						status: 503,
						body: {
							statusCode: 503,
							name: 'application_error',
							message: 'Service unavailable',
						},
					},
				])
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
			expect(result).toMatchObject({ kind: 'server-error', status: 503 })
		})

		it('returns network-error when fetch cannot connect', async () => {
			vi.stubGlobal(
				'fetch',
				vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result.kind).toBe('network-error')
		})
	})

	describe('PATCH error handling', () => {
		it('returns client-error on a 4xx PATCH', async () => {
			vi.stubGlobal(
				'fetch',
				mockFetchSequence([
					getOk(),
					{
						status: 422,
						body: {
							statusCode: 422,
							name: 'validation_error',
							message: 'Invalid first_name',
						},
					},
				])
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result).toMatchObject({ kind: 'client-error', status: 422 })
		})

		it('returns server-error on a 5xx PATCH', async () => {
			vi.stubGlobal(
				'fetch',
				mockFetchSequence([
					getOk(),
					{
						status: 503,
						body: {
							statusCode: 503,
							name: 'application_error',
							message: 'Service unavailable',
						},
					},
				])
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result).toMatchObject({ kind: 'server-error', status: 503 })
		})
	})
})
