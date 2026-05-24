import type {
	JsonValue,
	QueueDefinition,
	WorkflowContext,
	WorkflowDefinition,
} from "./types.server.js";

/** Defines a durable workflow. */
export function defineWorkflow<I extends JsonValue, O extends JsonValue>(
	name: string,
	handler: (ctx: WorkflowContext, input: I) => Promise<O> | O,
): WorkflowDefinition<I, O> {
	if (!name.trim()) throw new Error("Workflow name is required");
	return { name, handler };
}

/** Defines a named in-process queue. */
export function defineQueue(
	name: string,
	options: { concurrency: number },
): QueueDefinition {
	if (!name.trim()) throw new Error("Queue name is required");
	if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
		throw new Error("Queue concurrency must be a positive integer");
	}
	return { name, concurrency: options.concurrency };
}
