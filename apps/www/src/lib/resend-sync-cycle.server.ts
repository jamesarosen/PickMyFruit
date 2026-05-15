import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type * as schema from '@/data/schema.server'
import {
	processOneRow,
	type ResendClient,
} from '@/lib/resend-sync-process-row.server'
import { logger } from '@/lib/logger.server'

type Db = LibSQLDatabase<typeof schema>

/**
 * Runs one full sync cycle: calls processOneRow in a tight loop until the
 * queue is drained, a transient failure stalls progress, or the abort signal
 * fires between rows.
 *
 * The in-flight row always finishes before the loop observes the signal —
 * a Resend success without the cursor commit would mean the row gets re-sent
 * on next start. The signal check runs after each cursor advance.
 *
 * Returns the count of rows processed (cursor-advanced) this cycle.
 */
export async function runCycle(
	db: Db,
	resendClient: ResendClient,
	signal?: AbortSignal
): Promise<number> {
	let processed = 0

	// Sequential awaiting is intentional: each row's cursor advance must
	// commit before we select the next row, so parallelism would corrupt state.
	// oxlint-disable-next-line no-await-in-loop
	while (true) {
		// oxlint-disable-next-line no-await-in-loop
		const result = await processOneRow(db, resendClient)

		if (result === 'drained' || result === 'stalled') break

		processed++

		if (signal?.aborted) break
	}

	if (processed > 0) {
		logger.info({ processed }, 'resend-sync: cycle drained')
	}

	return processed
}
