import type { WorkflowContext } from "./context.server.js";

export type WorkflowHandler<TInput, TOutput> = (
	ctx: WorkflowContext,
	input: TInput,
) => Promise<TOutput>;

export type RegisteredWorkflow<TInput = unknown, TOutput = unknown> = {
	name: string;
	handler: WorkflowHandler<TInput, TOutput>;
};

const workflows = new Map<string, RegisteredWorkflow>();

/** Registers a workflow definition in the in-memory registry. */
export function registerWorkflow<TInput, TOutput>(
	workflow: RegisteredWorkflow<TInput, TOutput>,
): RegisteredWorkflow<TInput, TOutput> {
	workflows.set(workflow.name, workflow as RegisteredWorkflow);
	return workflow;
}

/** Returns a registered workflow by name. */
export function getWorkflowDefinition(
	name: string,
): RegisteredWorkflow | undefined {
	return workflows.get(name);
}

/** Clears the registry (tests only). */
export function clearWorkflowRegistry(): void {
	workflows.clear();
}

/** Lists registered workflow names. */
export function listWorkflowNames(): string[] {
	return [...workflows.keys()];
}
