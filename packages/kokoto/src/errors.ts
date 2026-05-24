/**
 * Error types raised by the kokoto runtime.
 */

/** Base class — all kokoto-thrown errors extend this. */
export class KokotoError extends Error {
	constructor(message: string) {
		super(message)
		this.name = 'KokotoError'
	}
}

/** Thrown inside a workflow body when cancellation has been requested. */
export class DurableCancelledError extends KokotoError {
	readonly workflowId: string
	constructor(workflowId: string) {
		super(`Workflow ${workflowId} was cancelled`)
		this.name = 'DurableCancelledError'
		this.workflowId = workflowId
	}
}

/** Thrown by `handle.result()` when its timeout elapses. */
export class DurableTimeoutError extends KokotoError {
	readonly workflowId: string
	readonly timeoutMs: number
	constructor(workflowId: string, timeoutMs: number) {
		super(`Timed out after ${timeoutMs}ms waiting for workflow ${workflowId}`)
		this.name = 'DurableTimeoutError'
		this.workflowId = workflowId
		this.timeoutMs = timeoutMs
	}
}

/** Thrown when a workflow name is enqueued but no definition is registered. */
export class UnknownWorkflowError extends KokotoError {
	readonly workflowName: string
	constructor(workflowName: string) {
		super(`No workflow registered for name "${workflowName}"`)
		this.name = 'UnknownWorkflowError'
		this.workflowName = workflowName
	}
}

/** Thrown when the runtime's boot integrity check fails. */
export class BootIntegrityError extends KokotoError {
	constructor(message: string) {
		super(message)
		this.name = 'BootIntegrityError'
	}
}

/** Thrown when a payload exceeds the 1 MB JSON byte cap. */
export class PayloadTooLargeError extends KokotoError {
	readonly bytes: number
	constructor(bytes: number) {
		super(`Payload size ${bytes} bytes exceeds the 1,000,000-byte cap`)
		this.name = 'PayloadTooLargeError'
		this.bytes = bytes
	}
}

/**
 * Wraps a recorded step error so the worker can rethrow it on replay without
 * losing the original message/stack.
 */
export class ReplayedStepError extends KokotoError {
	readonly stepName: string
	readonly originalMessage: string
	constructor(stepName: string, originalMessage: string) {
		super(originalMessage)
		this.name = 'ReplayedStepError'
		this.stepName = stepName
		this.originalMessage = originalMessage
	}
}
