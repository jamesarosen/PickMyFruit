import { processOneRow, type ProcessOneRowDeps } from "./process-row.js";
import { logger } from "./logger.js";

export interface RunCycleDeps extends ProcessOneRowDeps {
	signal?: AbortSignal;
}

/**
 * Drains the user queue in a tight processOneRow loop. The loop exits on
 * 'drained', 'stalled', or signal abort (between rows — the in-flight row
 * always finishes so we never have "Resend succeeded, cursor not committed").
 *
 * Returns the count of cursor-advancing iterations this cycle.
 */
export async function runCycle(deps: RunCycleDeps): Promise<number> {
	let processed = 0;
	const started = Date.now();

	while (true) {
		// eslint-disable-next-line no-await-in-loop -- each row's cursor advance must commit before the next row.
		const outcome = await processOneRow(deps);
		if (outcome === "drained" || outcome === "stalled") break;
		processed++;
		if (deps.signal?.aborted) break;
	}

	if (processed > 0) {
		logger.info(
			{ rows: processed, durationMs: Date.now() - started },
			"resend-sync: cycle drained",
		);
	}

	return processed;
}
