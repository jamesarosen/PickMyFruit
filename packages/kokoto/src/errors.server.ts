/** Thrown when a workflow is cancelled at a step boundary. */
export class DurableCancelledError extends Error {
	override readonly name = "DurableCancelledError";

	constructor(workflowId: string) {
		super(`Workflow ${workflowId} was cancelled`);
	}
}

/** Thrown when `handle.result()` times out waiting for completion. */
export class DurableTimeoutError extends Error {
	override readonly name = "DurableTimeoutError";

	constructor(workflowId: string, timeoutMs: number) {
		super(`Workflow ${workflowId} did not finish within ${timeoutMs}ms`);
	}
}

/** Thrown when enqueue payload exceeds the JSON byte cap. */
export class DurablePayloadError extends Error {
	override readonly name = "DurablePayloadError";

	constructor(message: string) {
		super(message);
	}
}
