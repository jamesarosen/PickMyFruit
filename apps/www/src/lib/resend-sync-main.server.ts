import type { LibSQLDatabase } from 'drizzle-orm/libsql'
import type * as schema from '@/data/schema.server'
import { runCycle } from '@/lib/resend-sync-cycle.server'
import type { ResendClient } from '@/lib/resend-sync-process-row.server'
import { logger } from '@/lib/logger.server'

type Db = LibSQLDatabase<typeof schema>

/** Resolves after `ms` milliseconds, or immediately when `signal` is aborted. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal.aborted) {
			resolve()
			return
		}
		const timer = setTimeout(resolve, ms)
		const onAbort = () => {
			clearTimeout(timer)
			resolve()
		}
		signal.addEventListener('abort', onAbort, { once: true })
	})
}

/** Dependencies injected into runWorker — real values in prod, stubs in tests. */
export interface WorkerDeps {
	db: Db
	resendClient: ResendClient
	pollMs: number
	signal: AbortSignal
}

/**
 * Runs the resend-sync worker loop until the abort signal fires.
 * Each iteration drains the user queue then sleeps for `pollMs`.
 */
export async function runWorker(deps: WorkerDeps): Promise<void> {
	const { db, resendClient, pollMs, signal } = deps

	// Sequential awaiting is intentional: each cycle must finish (and its cursor
	// advance must commit) before sleeping for the next poll interval.
	// oxlint-disable-next-line no-await-in-loop
	while (!signal.aborted) {
		// oxlint-disable-next-line no-await-in-loop
		await runCycle(db, resendClient, signal)
		if (signal.aborted) break
		// oxlint-disable-next-line no-await-in-loop
		await sleep(pollMs, signal)
	}

	logger.info('resend-sync: shutting down')
}
