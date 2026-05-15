import { z } from 'zod'
import { eq } from 'drizzle-orm'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { resendSyncState } from './schema.server'
import type * as schema from './schema.server'

const CURSOR_KEY = 'cursor'

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
		.where(eq(resendSyncState.key, CURSOR_KEY))
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

/**
 * Writes the sync cursor to the database, advancing past the last processed user.
 *
 * Upserts so the worker is self-healing on dev databases created with db:push
 * (which only mirrors the schema, not the migration's INSERT for the seed row)
 * and against any operator action that drops the cursor row in production.
 */
export async function writeCursor(db: Db, cursor: Cursor): Promise<void> {
	const value = JSON.stringify(cursor)
	const updatedAt = new Date()
	await db
		.insert(resendSyncState)
		.values({ key: CURSOR_KEY, value, updatedAt })
		.onConflictDoUpdate({
			target: resendSyncState.key,
			set: { value, updatedAt },
		})
}
