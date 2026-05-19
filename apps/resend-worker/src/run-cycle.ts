import { processOneRow, type ProcessOneRowDeps } from "./process-row.js";
import { runCycle as runCycleScaffold } from "./cycle.js";

export interface RunCycleDeps extends ProcessOneRowDeps {
	signal?: AbortSignal;
}

/**
 * Drains the user-sync loop. Thin wrapper over the generic `cycle` helper so
 * the user-sync and email-jobs loops share scaffolding (drain logic, abort
 * handling, drain-log line). Returns the count of cursor-advancing iterations.
 */
export async function runCycle(deps: RunCycleDeps): Promise<number> {
	return runCycleScaffold({
		name: "resend-sync",
		step: () => processOneRow(deps),
		signal: deps.signal,
	});
}
