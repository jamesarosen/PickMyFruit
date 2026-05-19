import { logger } from "./logger.js";

export type CycleOutcome = "processed" | "drained" | "stalled";

export interface RunCycleOptions {
	/** Human-readable loop name used in the drain log. */
	name: string;
	/** Performs one iteration; returns what the loop should do next. */
	step: () => Promise<CycleOutcome>;
	/** Optional abort signal — checked between iterations only. */
	signal?: AbortSignal;
}

/**
 * Drains a loop in a tight `step()` cycle. Exits on 'drained', 'stalled', or
 * signal abort (between iterations — the in-flight iteration always finishes
 * so commits aren't dropped).
 *
 * The user-sync and jobs loops both use this; they only differ in `name` and
 * `step`. Returns the count of cursor-advancing iterations.
 */
export async function runCycle(options: RunCycleOptions): Promise<number> {
	let processed = 0;
	const started = Date.now();

	while (true) {
		// eslint-disable-next-line no-await-in-loop -- each step must commit before the next.
		const outcome = await options.step();
		if (outcome === "drained" || outcome === "stalled") break;
		processed++;
		if (options.signal?.aborted) break;
	}

	if (processed > 0) {
		logger.debug(
			{ rows: processed, durationMs: Date.now() - started, loop: options.name },
			`[${options.name}] cycle drained`,
		);
	} else {
		// Always log on each tick, even when empty — the issue's Slice-1
		// verification looks for `[resend-email] cycle drained` on an empty queue.
		logger.debug(
			{ rows: 0, durationMs: Date.now() - started, loop: options.name },
			`[${options.name}] cycle drained`,
		);
	}

	return processed;
}
