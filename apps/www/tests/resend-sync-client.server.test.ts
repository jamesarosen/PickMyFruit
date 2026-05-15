import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { createResendSyncClient } from '../src/lib/resend-sync-client.server'

const AUDIENCE_ID = 'audience-test-123'
const API_KEY = 're_test_key'
const RESEND_BASE_URL = 'https://api.resend.com'
const EXPECTED_URL = `${RESEND_BASE_URL}/audiences/${AUDIENCE_ID}/contacts`

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

function mockFetchOk(body: unknown = { id: faker.string.uuid() }) {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		})
	)
}

function mockFetchError(status: number, body: unknown) {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), {
			status,
			headers: { 'Content-Type': 'application/json' },
		})
	)
}

function mockFetchThrows(error: Error) {
	return vi.fn().mockRejectedValue(error)
}

describe('createResendSyncClient', () => {
	beforeEach(() => {
		vi.stubGlobal('fetch', mockFetchOk())
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	describe('request shape', () => {
		it('posts to the correct audience contacts endpoint', async () => {
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(makeContact())
			expect(vi.mocked(fetch)).toHaveBeenCalledOnce()
			const [url] = vi.mocked(fetch).mock.calls[0]
			expect(url).toBe(EXPECTED_URL)
		})

		it('uses POST method', async () => {
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(makeContact())
			const [, options] = vi.mocked(fetch).mock.calls[0]
			expect((options as RequestInit).method).toBe('POST')
		})

		it('sends the correct email in the request body', async () => {
			const contact = makeContact({ email: 'test@example.com' })
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(contact)
			const [, options] = vi.mocked(fetch).mock.calls[0]
			const body = JSON.parse((options as RequestInit).body as string)
			expect(body.email).toBe('test@example.com')
		})

		it('splits a full name into first_name and last_name', async () => {
			const contact = makeContact({ name: 'Jane Doe' })
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(contact)
			const [, options] = vi.mocked(fetch).mock.calls[0]
			const body = JSON.parse((options as RequestInit).body as string)
			expect(body.first_name).toBe('Jane')
			expect(body.last_name).toBe('Doe')
		})

		it('sends only first_name when the name has no space', async () => {
			const contact = makeContact({ name: 'Mononym' })
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(contact)
			const [, options] = vi.mocked(fetch).mock.calls[0]
			const body = JSON.parse((options as RequestInit).body as string)
			expect(body.first_name).toBe('Mononym')
			expect(body.last_name).toBeUndefined()
		})

		it('sends unsubscribed: false for an active user', async () => {
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			await client(makeContact())
			const [, options] = vi.mocked(fetch).mock.calls[0]
			const body = JSON.parse((options as RequestInit).body as string)
			expect(body.unsubscribed).toBe(false)
		})
	})

	describe('success', () => {
		it('returns { kind: "ok" } on a 200 response', async () => {
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result).toEqual({ kind: 'ok' })
		})
	})

	describe('4xx client error', () => {
		it('returns { kind: "client-error" } with status and message', async () => {
			vi.stubGlobal(
				'fetch',
				mockFetchError(422, {
					statusCode: 422,
					name: 'validation_error',
					message: 'Invalid email address',
				})
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result).toMatchObject({
				kind: 'client-error',
				status: 422,
				message: 'Invalid email address',
			})
		})
	})

	describe('5xx server error', () => {
		it('returns { kind: "server-error" } with status and message', async () => {
			vi.stubGlobal(
				'fetch',
				mockFetchError(503, {
					statusCode: 503,
					name: 'application_error',
					message: 'Service unavailable',
				})
			)
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result).toMatchObject({ kind: 'server-error', status: 503 })
		})
	})

	describe('network error', () => {
		it('returns { kind: "network-error" } when fetch cannot connect', async () => {
			vi.stubGlobal('fetch', mockFetchThrows(new Error('connect ECONNREFUSED')))
			const client = createResendSyncClient(API_KEY, AUDIENCE_ID)
			const result = await client(makeContact())
			expect(result.kind).toBe('network-error')
		})
	})
})
