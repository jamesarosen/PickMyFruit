// Records boot time and tracks whether the first request has completed.
// firstRequest flips to false in a finally block after the first request.

let _startedAt = Date.now();
let _firstRequest = true;

/** Returns cold-start metadata for inclusion in the current request's response. */
export function getColdStartInfo(): { coldStart: boolean; bootMs: number } {
	return {
		coldStart: _firstRequest,
		bootMs: Date.now() - _startedAt,
	};
}

/** Marks the first request as complete; subsequent calls to getColdStartInfo return coldStart: false. */
export function markFirstRequestComplete(): void {
	_firstRequest = false;
}

/**
 * Resets cold-start state for testing.
 * @param fakeStartedAt - Optional fake boot timestamp (ms since epoch). Defaults to Date.now().
 * @internal Do not call from production code.
 */
export function _resetForTesting(fakeStartedAt?: number): void {
	if (process.env.NODE_ENV === "production") {
		throw new Error("_resetForTesting called in production");
	}
	_startedAt = fakeStartedAt ?? Date.now();
	_firstRequest = true;
}
