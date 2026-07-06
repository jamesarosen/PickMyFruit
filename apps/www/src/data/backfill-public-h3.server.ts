/**
 * One-off backfill for `listings.public_h3_index` on rows created before the
 * column existed. H3 can't be computed in SQLite, so we derive the res-8 cell
 * from the stored res-13 `h3Index` in application code. Idempotent: only rows
 * with a NULL `public_h3_index` are touched.
 *
 * Run with: `pnpm db:backfill-public-h3`
 */
import { eq, isNull } from 'drizzle-orm'
import { db } from './db.server'
import { listings } from './schema.server'
import { toPublicH3Index } from './listing'
import { logger } from '@/lib/logger.server'

export async function backfillPublicH3Index(): Promise<number> {
	const rows = await db
		.select({ id: listings.id, h3Index: listings.h3Index })
		.from(listings)
		.where(isNull(listings.publicH3Index))

	const results = await Promise.allSettled(
		rows.map((row) =>
			db
				.update(listings)
				.set({ publicH3Index: toPublicH3Index(row.h3Index) })
				.where(eq(listings.id, row.id))
		)
	)

	let updated = 0
	results.forEach((result, i) => {
		if (result.status === 'fulfilled') {
			updated += 1
		} else {
			logger.error(
				{ listingId: rows[i].id, error: result.reason },
				'backfill public_h3_index failed'
			)
		}
	})
	return updated
}

// Executed directly via vite-node.
backfillPublicH3Index()
	.then((n) => {
		logger.info({ updated: n }, 'public_h3_index backfill complete')
		process.exit(0)
	})
	.catch((error) => {
		logger.error({ error }, 'public_h3_index backfill aborted')
		process.exit(1)
	})
