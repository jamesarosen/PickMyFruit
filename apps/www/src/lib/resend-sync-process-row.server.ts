import { sql, asc } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { user } from '@/data/schema.server'
import type * as schema from '@/data/schema.server'
import {
	readCursor,
	writeCursor,
	type Cursor,
} from '@/data/resend-sync-cursor.server'
import { Sentry } from '@/lib/sentry'
import { logger } from '@/lib/logger.server'

type Db = LibSQLDatabase<typeof schema>

/** A user contact payload sent to Resend on each upsert. */
export interface ResendContact {
	id: string
	email: string
	name: string
	phone: string | null
}

export type ResendResult =
	| { kind: 'ok' }
	| { kind: 'client-error'; status: number; message: string }
	| { kind: 'server-error'; status: number; message: string }
	| { kind: 'network-error'; error: Error }

/** Injected Resend upsert function — real HTTP in prod, stub in tests. */
export type ResendClient = (contact: ResendContact) => Promise<ResendResult>

/** Return value of processOneRow, indicating what the cycle should do next. */
export type ProcessOneRowResult =
	| 'processed' // row upserted (or 4xx-skipped); cursor advanced; keep cycling
	| 'drained' // no rows past cursor; cycle is done
	| 'stalled' // 5xx/network; cursor not advanced; stop this cycle and retry next tick

/**
 * Selects the next user past the current cursor, calls the Resend client,
 * and advances the cursor on success or permanent (4xx) failure.
 *
 * On transient (5xx/network) failure the cursor is left unchanged so the
 * same row is retried on the next poll cycle.
 */
export async function processOneRow(
	db: Db,
	resendClient: ResendClient
): Promise<ProcessOneRowResult> {
	const cursor = await readCursor(db)

	const rows = await db
		.select({
			id: user.id,
			email: user.email,
			name: user.name,
			phone: user.phone,
			updatedAt: user.updatedAt,
		})
		.from(user)
		.where(
			sql`(${user.updatedAt}, ${user.id}) > (${cursor.updatedAt}, ${cursor.userId})`
		)
		.orderBy(asc(user.updatedAt), asc(user.id))
		.limit(1)

	if (rows.length === 0) return 'drained'

	const row = rows[0]
	const rowUpdatedAt =
		row.updatedAt instanceof Date
			? row.updatedAt.getTime()
			: Number(row.updatedAt)
	const newCursor: Cursor = { updatedAt: rowUpdatedAt, userId: row.id }

	const result = await resendClient({
		id: row.id,
		email: row.email,
		name: row.name,
		phone: row.phone,
	})

	if (result.kind === 'ok') {
		await writeCursor(db, newCursor)
		logger.info(
			{ userId: row.id, updatedAt: rowUpdatedAt },
			'resend-sync: upserted'
		)
		return 'processed'
	}

	if (result.kind === 'client-error') {
		// 4xx is a permanent failure for this row — advance past it so we never retry.
		await writeCursor(db, newCursor)
		Sentry.captureException(
			new Error(`Resend 4xx for user ${row.id}: ${result.message}`),
			{
				extra: { userId: row.id, status: result.status },
				fingerprint: ['resend-sync', '4xx'],
			}
		)
		return 'processed'
	}

	// 5xx or network error — stall; cursor stays put; Sentry notified.
	const err =
		result.kind === 'network-error'
			? result.error
			: new Error(`Resend ${result.status} for user ${row.id}: ${result.message}`)
	Sentry.captureException(err, {
		extra: { userId: row.id },
		fingerprint: ['resend-sync', '5xx-stall'],
	})
	return 'stalled'
}
