/**
 * Unit + integration tests for the generic outbox layer.
 *
 * Covers:
 * - typed `enqueueJob` rejects malformed payloads at the producer
 * - claim/complete/fail round-trips through real SQLite
 * - lease expiry unclaims a row so the next claim returns it
 * - concurrent claim returns a row to exactly one caller
 * - schema-mismatch is the worker's responsibility (covered in worker tests),
 *   but we assert here that a Zod-failing data column does NOT crash the
 *   producer's enqueue path.
 */
import { describe, it, expect } from 'vitest'
import {
	claimNextJob,
	completeJob,
	enqueueJob,
	failJob,
	getJobById,
} from '../src/data/jobs.server'
import { jobs } from '../src/data/schema.server'
import { useTestDb } from './helpers/test-db-connection'

describe('enqueueJob (typed producer)', () => {
	const testDb = useTestDb()

	it('rejects malformed payloads with a Zod error', async () => {
		const db = await testDb.getDb()
		await expect(
			// @ts-expect-error — exercising the runtime guard.
			enqueueJob(db, 'resend-email', { type: 'inquiry-email', to: 'not-an-email' })
		).rejects.toThrow()
		const rows = await db.select().from(jobs)
		expect(rows).toHaveLength(0)
	})

	it('rejects an unknown queue at compile time and at runtime', async () => {
		const db = await testDb.getDb()
		await expect(
			// @ts-expect-error — unknown queue name.
			enqueueJob(db, 'does-not-exist', { type: 'noop' })
		).rejects.toThrow()
	})

	it('inserts a row with a UUIDv7 id, current available_at, attempts=0', async () => {
		const db = await testDb.getDb()
		const before = Date.now()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })
		const after = Date.now()
		const row = await getJobById(db, id)
		expect(row).not.toBeNull()
		expect(row!.id).toBe(id)
		expect(row!.queue).toBe('resend-email')
		expect(row!.attempts).toBe(0)
		expect(row!.completedAt).toBeNull()
		expect(row!.failedAt).toBeNull()
		expect(row!.claimedAt).toBeNull()
		const availableAtMs =
			row!.availableAt instanceof Date
				? row!.availableAt.getTime()
				: Number(row!.availableAt)
		expect(availableAtMs).toBeGreaterThanOrEqual(before)
		expect(availableAtMs).toBeLessThanOrEqual(after + 5)
		// UUIDv7 is 36 chars with 4 hyphens; the time-prefix sorts lexicographically.
		expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}/)
	})

	it('honors a future `availableAt` so the row is not claimable yet', async () => {
		const db = await testDb.getDb()
		const future = new Date(Date.now() + 60 * 1000)
		await enqueueJob(
			db,
			'resend-email',
			{ type: 'noop' },
			{ availableAt: future }
		)
		const claimed = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		expect(claimed).toBeNull()
	})
})

describe('claim/complete round-trip', () => {
	const testDb = useTestDb()

	it('returns the row, then completeJob marks it completed', async () => {
		const db = await testDb.getDb()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })

		const claimed = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		expect(claimed?.id).toBe(id)
		expect(claimed?.attempts).toBe(0)

		const completed = await completeJob(db, { id, workerId: 'w-1' })
		expect(completed).toBe(true)

		const row = await getJobById(db, id)
		expect(row?.completedAt).not.toBeNull()
	})

	it('claim returns null on an empty queue', async () => {
		const db = await testDb.getDb()
		const claimed = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		expect(claimed).toBeNull()
	})

	it('completeJob is a no-op if the worker no longer holds the lease', async () => {
		const db = await testDb.getDb()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })
		await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		const completed = await completeJob(db, { id, workerId: 'someone-else' })
		expect(completed).toBe(false)
		const row = await getJobById(db, id)
		expect(row?.completedAt).toBeNull()
	})

	it('completeJob is idempotent on already-completed rows (lost-ack retry)', async () => {
		const db = await testDb.getDb()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })
		await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		expect(await completeJob(db, { id, workerId: 'w-1' })).toBe(true)
		// Second call from same worker mimics a retried request after the
		// first response was lost.
		expect(await completeJob(db, { id, workerId: 'w-1' })).toBe(true)
	})
})

describe('failJob', () => {
	const testDb = useTestDb()

	it('with retryInSeconds: unclaims, advances available_at, bumps attempts', async () => {
		const db = await testDb.getDb()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })
		await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})

		const ok = await failJob(db, {
			id,
			workerId: 'w-1',
			error: 'Resend 503',
			retryInSeconds: 30,
		})
		expect(ok).toBe(true)
		const row = await getJobById(db, id)
		expect(row?.claimedAt).toBeNull()
		expect(row?.claimedBy).toBeNull()
		expect(row?.attempts).toBe(1)
		expect(row?.lastError).toBe('Resend 503')
		expect(row?.failedAt).toBeNull()
	})

	it('without retryInSeconds: marks permanently failed', async () => {
		const db = await testDb.getDb()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })
		await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})

		const ok = await failJob(db, {
			id,
			workerId: 'w-1',
			error: 'schema-mismatch',
		})
		expect(ok).toBe(true)
		const row = await getJobById(db, id)
		expect(row?.failedAt).not.toBeNull()
		expect(row?.lastError).toBe('schema-mismatch')
		expect(row?.attempts).toBe(1)
	})

	it('retry failJob is idempotent after the first call cleared claimedBy', async () => {
		const db = await testDb.getDb()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })
		await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		// First call succeeds and clears claimedBy.
		expect(
			await failJob(db, {
				id,
				workerId: 'w-1',
				error: 'Resend 503',
				retryInSeconds: 30,
			})
		).toBe(true)
		// Retried call from the same worker (mimics lost ack) reports success
		// instead of producing Sentry noise from a 0-row mismatch.
		expect(
			await failJob(db, {
				id,
				workerId: 'w-1',
				error: 'Resend 503',
				retryInSeconds: 30,
			})
		).toBe(true)
	})

	it('permanent failJob is idempotent on already-failed rows', async () => {
		const db = await testDb.getDb()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })
		await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		expect(
			await failJob(db, { id, workerId: 'w-1', error: 'schema-mismatch' })
		).toBe(true)
		expect(
			await failJob(db, { id, workerId: 'w-1', error: 'schema-mismatch' })
		).toBe(true)
	})
})

describe('lease expiry', () => {
	const testDb = useTestDb()

	it('reaper unclaims a row whose lease expired and the next claim returns it', async () => {
		const db = await testDb.getDb()
		// Force availableAt into the past so the injected `now` in claim is
		// still greater than the row's availability.
		const id = await enqueueJob(
			db,
			'resend-email',
			{ type: 'noop' },
			{ availableAt: new Date(0) }
		)

		// First worker claims at t=1000.
		const claimed1 = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 1,
			now: () => 1_000,
		})
		expect(claimed1?.id).toBe(id)

		// A second worker arrives 5 seconds later — well past the 1-second lease.
		const claimed2 = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-2',
			leaseSeconds: 60,
			now: () => 6_000,
		})
		expect(claimed2?.id).toBe(id)

		// `w-1` no longer owns the row; its complete is a no-op.
		const completed1 = await completeJob(db, { id, workerId: 'w-1' })
		expect(completed1).toBe(false)
		const completed2 = await completeJob(db, { id, workerId: 'w-2' })
		expect(completed2).toBe(true)
	})

	it('does NOT reclaim a row whose lease has not yet expired', async () => {
		const db = await testDb.getDb()
		await enqueueJob(
			db,
			'resend-email',
			{ type: 'noop' },
			{ availableAt: new Date(0) }
		)

		await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
			now: () => 1_000,
		})
		const claimed2 = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-2',
			leaseSeconds: 60,
			now: () => 2_000,
		})
		expect(claimed2).toBeNull()
	})
})

describe('claim exclusivity', () => {
	const testDb = useTestDb()

	// True cross-process concurrency is impossible to exercise from a single
	// libsql connection (drizzle serializes transactions per client). The
	// guarantee we need is SQL-level: once a row's `claimed_at` is non-null,
	// a second claim must not return it. The transactional claim in
	// `claimNextJob` provides that under prod's WAL + busy_timeout=5000ms.
	it('a row already claimed by one worker is not returned to a second', async () => {
		const db = await testDb.getDb()
		const id = await enqueueJob(db, 'resend-email', { type: 'noop' })

		const a = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-A',
			leaseSeconds: 60,
		})
		const b = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-B',
			leaseSeconds: 60,
		})

		expect(a?.id).toBe(id)
		expect(b).toBeNull()
		const row = await getJobById(db, id)
		expect(row?.claimedBy).toBe('w-A')
	})
})

describe('FIFO ordering', () => {
	const testDb = useTestDb()

	it('claims rows in (available_at, id) ascending order', async () => {
		const db = await testDb.getDb()
		const id1 = await enqueueJob(db, 'resend-email', { type: 'noop' })
		// UUIDv7's time prefix makes id2 sort after id1.
		await new Promise((r) => setTimeout(r, 2))
		const id2 = await enqueueJob(db, 'resend-email', { type: 'noop' })

		const first = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		expect(first?.id).toBe(id1)
		await completeJob(db, { id: id1, workerId: 'w-1' })
		const second = await claimNextJob(db, {
			queue: 'resend-email',
			workerId: 'w-1',
			leaseSeconds: 60,
		})
		expect(second?.id).toBe(id2)
	})
})
