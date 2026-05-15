/**
 * Integration test for the resend-sync worker.
 *
 * Drives runCycle against a real SQLite database with migrations applied,
 * exercising the schema, the (updated_at, id) index, the seeded cursor row,
 * and the cursor read/write code in one path. This is the test that catches
 * "the user table doesn't actually drive the worker" bugs that unit tests
 * with mocked drizzle can't.
 */
import { describe, it, expect, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { user, resendSyncState } from '../src/data/schema.server'
import { runCycle } from '../src/lib/resend-sync-cycle.server'
import type {
	ResendClient,
	ResendResult,
} from '../src/lib/resend-sync-process-row.server'
import {
	readCursor,
	DEFAULT_CURSOR,
} from '../src/data/resend-sync-cursor.server'
import { useTestDb } from './helpers/test-db-connection'

// Silence Sentry — we exercise both ok and error paths and don't want noise.
vi.mock('../src/lib/sentry', () => ({
	Sentry: { captureException: vi.fn() },
}))

vi.mock('../src/lib/logger.server', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

function okClient(): ResendClient & { calls: unknown[] } {
	const calls: unknown[] = []
	const fn = vi.fn(async (contact) => {
		calls.push(contact)
		return { kind: 'ok' as const } satisfies ResendResult
	}) as ResendClient & { calls: unknown[] }
	fn.calls = calls
	return fn
}

function serverErrorClient(): ResendClient {
	return vi.fn(async () => ({
		kind: 'server-error' as const,
		status: 503,
		message: 'Service Unavailable',
	}))
}

function clientErrorClient(): ResendClient {
	return vi.fn(async () => ({
		kind: 'client-error' as const,
		status: 422,
		message: 'invalid email',
	}))
}

describe('resend-sync integration', () => {
	const testDb = useTestDb()

	it('starts from the seeded DEFAULT_CURSOR after migrations', async () => {
		const db = await testDb.getDb()
		const cursor = await readCursor(db)
		expect(cursor).toEqual(DEFAULT_CURSOR)
	})

	it('drains pending users to a stub Resend client and advances the cursor', async () => {
		const db = await testDb.getDb()

		const alice = {
			id: 'user_alice',
			email: 'alice@example.com',
			name: 'Alice Anderson',
			phone: null,
			updatedAt: new Date(1_000_000),
		}
		const bob = {
			id: 'user_bob',
			email: 'bob@example.com',
			name: 'Bob Brown',
			phone: '+15551234567',
			updatedAt: new Date(2_000_000),
		}
		await db.insert(user).values([alice, bob])

		const client = okClient()
		const processed = await runCycle(db, client)

		expect(processed).toBe(2)
		expect(client.calls).toEqual([
			{ id: alice.id, email: alice.email, name: alice.name, phone: alice.phone },
			{ id: bob.id, email: bob.email, name: bob.name, phone: bob.phone },
		])

		const cursor = await readCursor(db)
		expect(cursor).toEqual({ updatedAt: 2_000_000, userId: 'user_bob' })
	})

	it('orders rows by (updated_at, id) so collisions are tie-broken by id', async () => {
		const db = await testDb.getDb()
		const sharedTime = new Date(5_000_000)
		await db.insert(user).values([
			{
				id: 'user_2',
				email: '2@example.com',
				name: 'Two',
				phone: null,
				updatedAt: sharedTime,
			},
			{
				id: 'user_1',
				email: '1@example.com',
				name: 'One',
				phone: null,
				updatedAt: sharedTime,
			},
			{
				id: 'user_3',
				email: '3@example.com',
				name: 'Three',
				phone: null,
				updatedAt: sharedTime,
			},
		])

		const client = okClient()
		await runCycle(db, client)

		expect(client.calls.map((c) => (c as { id: string }).id)).toEqual([
			'user_1',
			'user_2',
			'user_3',
		])
	})

	it('does not advance the cursor on 5xx and is retried next cycle', async () => {
		const db = await testDb.getDb()
		await db.insert(user).values({
			id: 'user_flaky',
			email: 'flaky@example.com',
			name: 'Flaky',
			phone: null,
			updatedAt: new Date(7_000_000),
		})

		expect(await runCycle(db, serverErrorClient())).toBe(0)
		expect(await readCursor(db)).toEqual(DEFAULT_CURSOR)

		// Next cycle, the Resend stub recovers — the same row is retried and now
		// the cursor advances past it.
		const recovered = okClient()
		expect(await runCycle(db, recovered)).toBe(1)
		expect(recovered.calls).toHaveLength(1)
		expect(await readCursor(db)).toEqual({
			updatedAt: 7_000_000,
			userId: 'user_flaky',
		})
	})

	it('advances the cursor past a 4xx row (permanent failure)', async () => {
		const db = await testDb.getDb()
		await db.insert(user).values({
			id: 'user_bad_email',
			email: 'not-an-email',
			name: 'Invalid',
			phone: null,
			updatedAt: new Date(9_000_000),
		})

		expect(await runCycle(db, clientErrorClient())).toBe(1)
		expect(await readCursor(db)).toEqual({
			updatedAt: 9_000_000,
			userId: 'user_bad_email',
		})
	})

	it('is idempotent: a second cycle with no new rows is a no-op', async () => {
		const db = await testDb.getDb()
		await db.insert(user).values({
			id: 'user_solo',
			email: 'solo@example.com',
			name: 'Solo',
			phone: null,
			updatedAt: new Date(11_000_000),
		})

		const first = okClient()
		expect(await runCycle(db, first)).toBe(1)
		expect(first.calls).toHaveLength(1)

		const second = okClient()
		expect(await runCycle(db, second)).toBe(0)
		expect(second.calls).toHaveLength(0)
	})

	it('seeds resend_sync_state with the cursor row after migrations', async () => {
		const db = await testDb.getDb()
		const rows = await db
			.select()
			.from(resendSyncState)
			.where(eq(resendSyncState.key, 'cursor'))
		expect(rows).toHaveLength(1)
		expect(JSON.parse(rows[0].value)).toEqual({ updatedAt: 0, userId: '' })
	})

	it('self-heals when the cursor row is missing (dev db:push case)', async () => {
		const db = await testDb.getDb()
		// Simulate a dev DB created via db:push, which mirrors the schema but
		// does not run the migration's INSERT seed.
		await db.delete(resendSyncState).where(eq(resendSyncState.key, 'cursor'))
		await db.insert(user).values({
			id: 'user_x',
			email: 'x@example.com',
			name: 'Ex',
			phone: null,
			updatedAt: new Date(13_000_000),
		})

		const client = okClient()
		expect(await runCycle(db, client)).toBe(1)
		expect(await readCursor(db)).toEqual({
			updatedAt: 13_000_000,
			userId: 'user_x',
		})
	})
})
