import { registerWorkflow, type WorkflowHandler } from "./registry.server.js";

export type WorkflowDefinition<TInput, TOutput> = {
	name: string;
	handler: WorkflowHandler<TInput, TOutput>;
};

/** Defines a durable workflow and registers it for the runtime. */
export function defineWorkflow<TInput, TOutput>(
	name: string,
	handler: WorkflowHandler<TInput, TOutput>,
): WorkflowDefinition<TInput, TOutput> {
	const workflow = { name, handler };
	return registerWorkflow(workflow);
}
