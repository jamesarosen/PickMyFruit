/**
 * Integration + contract test for /internal/v1/users/next.
 *
 * - Drives the route's pure handler (handleInternalUsersNext) against a real
 *   SQLite DB seeded with user rows.
 * - Asserts response shape via the shared Zod schema so the worker's copy of
 *   the schema can be kept in sync by diff.
 * - Exercises the auth perimeter (current secret, previous secret during
 *   rotation, missing/bad secret → 404 not 401, rate limit).
 */
import { describe, it, expect, vi } from 'vitest'
import { user } from '../src/data/schema.server'
import { handleInternalUsersNext } from '../src/lib/internal-users-next-handler.server'
import {
	internalUsersNextResponseSchema,
	selectNextUser,
} from '../src/lib/internal-users-next.server'
import { decodeCursor, ORIGIN_CURSOR } from '../src/lib/internal-cursor.server'
import { createRateLimiter } from '../src/lib/internal-rate-limit.server'
import { useTestDb } from './helpers/test-db-connection'

vi.mock('../src/lib/sentry', () => ({
	Sentry: { captureException: vi.fn() },
}))

vi.mock('../src/lib/logger.server', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

const CURRENT = 'current-secret-min-32-chars-aaaaaaa'
const PREVIOUS = 'previous-secret-min-32-chars-bbbbbb'

function authedRequest(
	cursor: string | null,
	overrides: { secret?: string | null; ip?: string } = {}
): Request {
	const headers = new Headers()
	const secret =
		overrides.secret === undefined ? CURRENT : (overrides.secret ?? '')
	if (secret) headers.set('x-internal-auth', secret)
	headers.set('x-forwarded-for', overrides.ip ?? '203.0.113.7')
	const url = cursor
		? `http://pickmyfruit.flycast/internal/v1/users/next?cursor=${encodeURIComponent(cursor)}`
		: 'http://pickmyfruit.flycast/internal/v1/users/next'
	return new Request(url, { method: 'GET', headers })
}

function freshLimiter() {
	return createRateLimiter({ windowMs: 60_000, max: 1_000 })
}

describe('handleInternalUsersNext (contract + auth)', () => {
	const testDb = useTestDb()

	it('drains the user queue in (updated_at, id) order, returning a Zod-valid response each time', async () => {
		const db = await testDb.getDb()
		await db.insert(user).values([
			{
				id: 'user_a',
				email: 'a@example.com',
				name: 'Alice',
				updatedAt: new Date(1_000_000),
			},
			{
				id: 'user_b',
				email: 'b@example.com',
				name: 'Bob',
				updatedAt: new Date(2_000_000),
			},
		])

		const deps = {
			auth: { current: CURRENT, previous: PREVIOUS },
			limiter: freshLimiter(),
			loadUser: (cursor: string | null) => selectNextUser(db, cursor),
		}

		const first = await handleInternalUsersNext(authedRequest(null), deps)
		expect(first.status).toBe(200)
		const firstBody = internalUsersNextResponseSchema.parse(await first.json())
		expect(firstBody.user?.id).toBe('user_a')

		const second = await handleInternalUsersNext(
			authedRequest(firstBody.nextCursor),
			deps
		)
		const secondBody = internalUsersNextResponseSchema.parse(await second.json())
		expect(secondBody.user?.id).toBe('user_b')

		const drained = await handleInternalUsersNext(
			authedRequest(secondBody.nextCursor),
			deps
		)
		const drainedBody = internalUsersNextResponseSchema.parse(
			await drained.json()
		)
		expect(drainedBody.user).toBeNull()
		// Drained response echoes the request cursor so the worker persists it idempotently.
		expect(decodeCursor(drainedBody.nextCursor)).toEqual(
			decodeCursor(secondBody.nextCursor)
		)
	})

	it('tie-breaks rows with the same updated_at by id ascending', async () => {
		const db = await testDb.getDb()
		const sharedTime = new Date(5_000_000)
		await db.insert(user).values([
			{
				id: 'user_z',
				email: 'z@example.com',
				name: 'Zed',
				updatedAt: sharedTime,
			},
			{
				id: 'user_a',
				email: 'a@example.com',
				name: 'Ada',
				updatedAt: sharedTime,
			},
		])

		const deps = {
			auth: { current: CURRENT },
			limiter: freshLimiter(),
			loadUser: (cursor: string | null) => selectNextUser(db, cursor),
		}

		const first = await handleInternalUsersNext(authedRequest(null), deps)
		const firstBody = await first.json()
		expect(firstBody.user.id).toBe('user_a')

		const second = await handleInternalUsersNext(
			authedRequest(firstBody.nextCursor),
			deps
		)
		const secondBody = await second.json()
		expect(secondBody.user.id).toBe('user_z')
	})

	it('returns ORIGIN_CURSOR-equivalent payload when no users exist', async () => {
		const db = await testDb.getDb()
		const deps = {
			auth: { current: CURRENT },
			limiter: freshLimiter(),
			loadUser: (cursor: string | null) => selectNextUser(db, cursor),
		}
		const res = await handleInternalUsersNext(authedRequest(null), deps)
		const body = internalUsersNextResponseSchema.parse(await res.json())
		expect(body.user).toBeNull()
		expect(decodeCursor(body.nextCursor)).toEqual(ORIGIN_CURSOR)
	})

	it('returns 404 (not 401) when the auth header is missing', async () => {
		const db = await testDb.getDb()
		const res = await handleInternalUsersNext(
			authedRequest(null, { secret: null }),
			{
				auth: { current: CURRENT },
				limiter: freshLimiter(),
				loadUser: (cursor) => selectNextUser(db, cursor),
			}
		)
		expect(res.status).toBe(404)
	})

	it('returns 404 when the auth header is wrong', async () => {
		const db = await testDb.getDb()
		const res = await handleInternalUsersNext(
			authedRequest(null, { secret: 'nope-not-the-secret' }),
			{
				auth: { current: CURRENT },
				limiter: freshLimiter(),
				loadUser: (cursor) => selectNextUser(db, cursor),
			}
		)
		expect(res.status).toBe(404)
	})

	it('accepts the previous secret during rotation', async () => {
		const db = await testDb.getDb()
		await db.insert(user).values({
			id: 'u',
			email: 'u@example.com',
			name: 'You',
			updatedAt: new Date(100),
		})
		const res = await handleInternalUsersNext(
			authedRequest(null, { secret: PREVIOUS }),
			{
				auth: { current: CURRENT, previous: PREVIOUS },
				limiter: freshLimiter(),
				loadUser: (cursor) => selectNextUser(db, cursor),
			}
		)
		expect(res.status).toBe(200)
	})

	it('rate-limits per IP before checking the secret', async () => {
		const db = await testDb.getDb()
		const limiter = createRateLimiter({ windowMs: 60_000, max: 2 })
		const deps = {
			auth: { current: CURRENT },
			limiter,
			loadUser: (cursor: string | null) => selectNextUser(db, cursor),
		}

		expect(
			(
				await handleInternalUsersNext(
					authedRequest(null, { ip: '198.51.100.1' }),
					deps
				)
			).status
		).toBe(200)
		expect(
			(
				await handleInternalUsersNext(
					authedRequest(null, { ip: '198.51.100.1' }),
					deps
				)
			).status
		).toBe(200)

		const blocked = await handleInternalUsersNext(
			authedRequest(null, { ip: '198.51.100.1', secret: 'wrong' }),
			deps
		)
		expect(blocked.status).toBe(429)
		expect(blocked.headers.get('retry-after')).toBeTruthy()
	})

	it('returns 500 when the DB throws (the worker treats this as a stall)', async () => {
		const db = await testDb.getDb()
		void db
		const deps = {
			auth: { current: CURRENT },
			limiter: freshLimiter(),
			loadUser: async () => {
				throw new Error('boom')
			},
		}
		const res = await handleInternalUsersNext(authedRequest(null), deps)
		expect(res.status).toBe(500)
	})
})
