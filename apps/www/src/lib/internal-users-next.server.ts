import { sql, asc } from 'drizzle-orm'
import { z } from 'zod'
import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import { user } from '@/data/schema.server'
import type * as schema from '@/data/schema.server'
import {
	decodeCursor,
	encodeCursor,
	type DecodedCursor,
} from '@/lib/internal-cursor.server'

type Db = LibSQLDatabase<typeof schema>

/**
 * Zod schema for the `/internal/v1/users/next` response body.
 *
 * **Duplicated in `apps/resend-worker/src/internal-api-schema.ts`.** Keep both
 * copies in sync. At this scale, honest duplication beats a `packages/contracts`
 * workspace that no second consumer has appeared to justify.
 */
export const internalUsersNextResponseSchema = z.object({
	user: z
		.object({
			id: z.string(),
			email: z.string(),
			name: z.string(),
		})
		.nullable(),
	nextCursor: z.string(),
})

export type InternalUsersNextResponse = z.infer<
	typeof internalUsersNextResponseSchema
>

/**
 * Selects the next user whose `(updated_at, id)` tuple is greater than the
 * decoded cursor, ordered to make the cursor monotonic. Returns the payload
 * the worker round-trips: the user (or null when drained) plus the next cursor.
 */
export async function selectNextUser(
	db: Db,
	rawCursor: string | null | undefined
): Promise<InternalUsersNextResponse> {
	const cursor = decodeCursor(rawCursor)

	const rows = await db
		.select({
			id: user.id,
			email: user.email,
			name: user.name,
			updatedAt: user.updatedAt,
		})
		.from(user)
		.where(
			sql`(${user.updatedAt}, ${user.id}) > (${cursor.updatedAt}, ${cursor.userId})`
		)
		.orderBy(asc(user.updatedAt), asc(user.id))
		.limit(1)

	if (rows.length === 0) {
		return {
			user: null,
			nextCursor: encodeCursor(cursor),
		}
	}

	const row = rows[0]
	const updatedAt =
		row.updatedAt instanceof Date
			? row.updatedAt.getTime()
			: Number(row.updatedAt)
	const next: DecodedCursor = { updatedAt, userId: row.id }
	return {
		user: { id: row.id, email: row.email, name: row.name },
		nextCursor: encodeCursor(next),
	}
}
