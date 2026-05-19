import { and, asc, eq, isNull, lt, sql } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { v7 as uuidv7 } from 'uuid'
import { z } from 'zod'
import * as schema from '@/data/schema.server'
import { jobs, type Job } from '@/data/schema.server'

type Db = LibSQLDatabase<typeof schema>

/**
 * Payload schema for the `resend-email` queue. A discriminated union on
 * `type` lets one worker handler dispatch by `data.type` after Zod narrows it.
 * Producers and the worker share this schema; a schema-mismatch on read fails
 * the row without crashing the worker.
 */
export const ResendEmailJob = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('inquiry-email'),
		from: z.string().min(1),
		to: z.string().email(),
		replyTo: z.string().email().optional(),
		subject: z.string().min(1),
		html: z.string().min(1),
	}),
	z.object({
		type: z.literal('newsletter-opt-out'),
		email: z.string().email(),
	}),
	z.object({ type: z.literal('noop') }),
])

export type ResendEmailJobData = z.infer<typeof ResendEmailJob>

/**
 * Map of queue name → payload Zod schema. Adding a new queue is a
 * single-entry change here plus a worker handler registration.
 */
export const queueSchemas = {
	'resend-email': ResendEmailJob,
} as const

export type Queue = keyof typeof queueSchemas
export type DataFor<Q extends Queue> = z.infer<(typeof queueSchemas)[Q]>

export interface EnqueueOptions {
	/** Earliest time the job becomes claimable. Defaults to now. */
	availableAt?: Date
}

/**
 * Inserts a new job row. Validates `data` against the queue's Zod schema so a
 * malformed payload fails at the producer instead of poisoning the worker.
 * The generated UUIDv7 id sorts lexicographically by time, preserves FIFO
 * under `(available_at, id)` ordering, and doubles as the Resend
 * idempotency-key.
 */
export async function enqueueJob<Q extends Queue>(
	db: Db,
	queue: Q,
	data: DataFor<Q>,
	options: EnqueueOptions = {}
): Promise<string> {
	const validated = queueSchemas[queue].parse(data)
	const id = uuidv7()
	const availableAt = options.availableAt ?? new Date()
	await db.insert(jobs).values({
		id,
		queue,
		data: JSON.stringify(validated),
		availableAt,
	})
	return id
}

export interface ClaimedJob {
	id: string
	queue: string
	data: string
	attempts: number
}

export interface ClaimJobInput {
	queue: string
	workerId: string
	leaseSeconds: number
	now?: () => number
}

/**
 * Atomically reclaims expired-lease rows then claims the next eligible row.
 *
 * Wrapped in a single SQLite transaction so the reaper UPDATE, the candidate
 * SELECT, and the claiming UPDATE are serialized as one unit against
 * concurrent callers. The `WHERE claimed_at IS NULL` guard on the final
 * UPDATE remains as a belt-and-braces check.
 *
 * Returns `null` when the queue is drained.
 */
export async function claimNextJob(
	db: Db,
	input: ClaimJobInput
): Promise<ClaimedJob | null> {
	const now = input.now?.() ?? Date.now()
	const nowDate = new Date(now)

	return db.transaction(async (tx) => {
		// Reaper: unclaim rows whose lease expired. Cheap; runs every claim.
		await tx
			.update(jobs)
			.set({ claimedAt: null, claimedBy: null, leaseSeconds: null })
			.where(
				and(
					eq(jobs.queue, input.queue),
					isNull(jobs.completedAt),
					isNull(jobs.failedAt),
					sql`${jobs.claimedAt} IS NOT NULL`,
					sql`(${jobs.claimedAt} + ${jobs.leaseSeconds} * 1000) < ${now}`
				)
			)

		const candidates = await tx
			.select({ id: jobs.id })
			.from(jobs)
			.where(
				and(
					eq(jobs.queue, input.queue),
					isNull(jobs.completedAt),
					isNull(jobs.failedAt),
					isNull(jobs.claimedAt),
					lt(jobs.availableAt, new Date(now + 1))
				)
			)
			.orderBy(asc(jobs.availableAt), asc(jobs.id))
			.limit(1)

		if (candidates.length === 0) return null

		const [{ id }] = candidates

		const result = await tx
			.update(jobs)
			.set({
				claimedAt: nowDate,
				claimedBy: input.workerId,
				leaseSeconds: input.leaseSeconds,
			})
			.where(and(eq(jobs.id, id), isNull(jobs.claimedAt)))
			.returning({
				id: jobs.id,
				queue: jobs.queue,
				data: jobs.data,
				attempts: jobs.attempts,
			})

		// Inside a transaction, the conditional UPDATE either matches the row
		// we just SELECTed or the transaction rolls back. A 0-row result here
		// would indicate the row was modified between our SELECT and UPDATE
		// in the same tx, which shouldn't happen.
		return result.length === 0 ? null : result[0]
	})
}

export interface CompleteJobInput {
	id: string
	workerId: string
	now?: () => number
}

/**
 * Marks a claimed job as completed. Returns false only if the row exists but
 * is owned by a different worker (its lease expired and was reaped). A
 * retried call from the same worker after a lost network ack is reported as
 * success so the worker doesn't loop on Sentry noise.
 */
export async function completeJob(
	db: Db,
	input: CompleteJobInput
): Promise<boolean> {
	const now = new Date(input.now?.() ?? Date.now())
	const rows = await db
		.select({
			claimedBy: jobs.claimedBy,
			completedAt: jobs.completedAt,
			failedAt: jobs.failedAt,
		})
		.from(jobs)
		.where(eq(jobs.id, input.id))
		.limit(1)
	if (rows.length === 0) return false
	const [row] = rows
	// Idempotency: an earlier /complete call from this worker may have
	// succeeded server-side but the ack got lost. The row no longer has
	// `claimedBy` (cleared on retry) OR `completedAt` is set; either way the
	// worker's intent is already recorded.
	if (row.completedAt !== null) return true
	if (row.claimedBy !== input.workerId) return false
	const result = await db
		.update(jobs)
		.set({ completedAt: now })
		.where(and(eq(jobs.id, input.id), eq(jobs.claimedBy, input.workerId)))
		.returning({ id: jobs.id })
	return result.length > 0
}

export interface FailJobInput {
	id: string
	workerId: string
	error: string
	retryInSeconds?: number
	now?: () => number
}

/**
 * Records a failure. With `retryInSeconds`, the row is unclaimed and
 * `available_at` advances so the worker can retry after backoff. Without it,
 * the row is marked permanently failed.
 *
 * Idempotent on the "lost ack" path: a retried `/fail` from the same worker
 * whose first call already cleared `claimed_by` is reported as success rather
 * than 0-row mismatch. This avoids the Sentry-noise loop where the worker
 * keeps re-failing the same row after its first fail succeeded server-side
 * but the network ack was dropped.
 */
export async function failJob(db: Db, input: FailJobInput): Promise<boolean> {
	const now = new Date(input.now?.() ?? Date.now())
	const rows = await db
		.select({
			claimedBy: jobs.claimedBy,
			completedAt: jobs.completedAt,
			failedAt: jobs.failedAt,
		})
		.from(jobs)
		.where(eq(jobs.id, input.id))
		.limit(1)
	if (rows.length === 0) return false
	const [row] = rows

	if (typeof input.retryInSeconds === 'number') {
		// Retry path: idempotent if the prior call already unclaimed the row
		// (claimedBy is null) — likely a network retry from the same worker.
		if (row.completedAt !== null || row.failedAt !== null) return true
		if (row.claimedBy !== input.workerId) {
			// Owned by another worker (lease was reaped). Caller's failure
			// signal is irrelevant to the current owner's lease.
			return row.claimedBy === null
		}
		const availableAt = new Date(now.getTime() + input.retryInSeconds * 1000)
		const result = await db
			.update(jobs)
			.set({
				claimedAt: null,
				claimedBy: null,
				leaseSeconds: null,
				attempts: sql`${jobs.attempts} + 1`,
				lastError: input.error,
				availableAt,
			})
			.where(and(eq(jobs.id, input.id), eq(jobs.claimedBy, input.workerId)))
			.returning({ id: jobs.id })
		return result.length > 0
	}

	// Permanent-fail path: idempotent on already-failed rows.
	if (row.failedAt !== null) return true
	if (row.completedAt !== null) return false
	if (row.claimedBy !== input.workerId) return false
	const result = await db
		.update(jobs)
		.set({
			failedAt: now,
			attempts: sql`${jobs.attempts} + 1`,
			lastError: input.error,
		})
		.where(and(eq(jobs.id, input.id), eq(jobs.claimedBy, input.workerId)))
		.returning({ id: jobs.id })
	return result.length > 0
}

/**
 * Convenience for tests: fetch a job by id without going through the claim
 * flow. Not part of the worker contract.
 */
export async function getJobById(db: Db, id: string): Promise<Job | null> {
	const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1)
	return rows[0] ?? null
}
