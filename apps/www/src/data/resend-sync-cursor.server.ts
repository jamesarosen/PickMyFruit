import { z } from 'zod'
import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { resendSyncState } from './schema.server'
import type * as schema from './schema.server'

type Db = LibSQLDatabase<typeof schema>

/** Zod schema for the JSON value stored under key='cursor' in resend_sync_state. */
export const cursorSchema = z.object({
	updatedAt: z.number().int().nonnegative(),
	userId: z.string(),
})

export type Cursor = z.infer<typeof cursorSchema>

/** Sentinel cursor that causes the first worker cycle to drain all existing users. */
export const DEFAULT_CURSOR: Cursor = { updatedAt: 0, userId: '' }

/**
 * Reads the sync cursor from the database.
 * Returns DEFAULT_CURSOR when the row is absent or its value fails validation.
 */
export async function readCursor(db: Db): Promise<Cursor> {
	const rows = await db
		.select()
		.from(resendSyncState)
		.where(eq(resendSyncState.key, 'cursor'))
		.limit(1)
	if (rows.length === 0) return DEFAULT_CURSOR

	let parsed: unknown
	try {
		parsed = JSON.parse(rows[0].value)
	} catch {
		return DEFAULT_CURSOR
	}

	const result = cursorSchema.safeParse(parsed)
	return result.success ? result.data : DEFAULT_CURSOR
}

/** Writes the sync cursor to the database, advancing past the last processed user. */
export async function writeCursor(db: Db, cursor: Cursor): Promise<void> {
	await db
		.update(resendSyncState)
		.set({ value: JSON.stringify(cursor), updatedAt: new Date() })
		.where(eq(resendSyncState.key, 'cursor'))
}
