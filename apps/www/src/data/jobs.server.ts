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
 * The reaper UPDATE inside the same call keeps the operational story to a
 * single endpoint — no second process required. SQLite's single-writer model
 * means the reaper + claim sequence is serialized against other claim calls.
 *
 * Returns `null` when the queue is drained.
 */
export async function claimNextJob(
	db: Db,
	input: ClaimJobInput
): Promise<ClaimedJob | null> {
	const now = input.now?.() ?? Date.now()
	const nowDate = new Date(now)

	// Reaper: unclaim rows whose lease expired. Cheap; runs every claim.
	await db
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

	const candidates = await db
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

	const id = candidates[0].id

	// Conditional UPDATE returning the row only if we won the race. SQLite has
	// no native SKIP LOCKED, but `WHERE claimed_at IS NULL` filters out anyone
	// who beat us between the SELECT and the UPDATE.
	const result = await db
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

	if (result.length === 0) {
		// Another worker won the race in this same millisecond; the caller can
		// retry or treat as drained. Treating as drained keeps the contract
		// "null means try again next tick" simple.
		return null
	}
	return result[0]
}

export interface CompleteJobInput {
	id: string
	workerId: string
	now?: () => number
}

/**
 * Marks a claimed job as completed. Returns false if the worker no longer
 * holds the lease (e.g. it expired and was reaped — another worker may have
 * already done the work).
 */
export async function completeJob(
	db: Db,
	input: CompleteJobInput
): Promise<boolean> {
	const now = new Date(input.now?.() ?? Date.now())
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
 */
export async function failJob(db: Db, input: FailJobInput): Promise<boolean> {
	const now = new Date(input.now?.() ?? Date.now())

	if (typeof input.retryInSeconds === 'number') {
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
