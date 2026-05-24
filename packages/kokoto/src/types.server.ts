export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
	| JsonPrimitive
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface WorkflowContext {
	readonly workflowId: string;
	readonly workflowName: string;
	readonly queue: string | null;
	now(): Date;
	stepKey(stepId: string): string;
	step<T extends JsonValue>(
		stepId: string,
		fn: () => Promise<T> | T,
		options?: StepOptions,
	): Promise<T>;
	throwIfCancelled(): Promise<void>;
}

export interface StepOptions {
	budgetWarnMs?: number;
}

export interface WorkflowDefinition<I extends JsonValue, O extends JsonValue> {
	readonly name: string;
	readonly handler: (ctx: WorkflowContext, input: I) => Promise<O> | O;
}

export interface QueueDefinition {
	readonly name: string;
	readonly concurrency: number;
}

export interface RuntimeLogger {
	debug(fields: Record<string, unknown>, message: string): void;
	info(fields: Record<string, unknown>, message: string): void;
	warn(fields: Record<string, unknown>, message: string): void;
}

export interface RuntimeTelemetry {
	increment(metric: string, attributes?: Record<string, string>): void;
	distribution(
		metric: string,
		value: number,
		attributes?: Record<string, string>,
	): void;
	captureException(error: unknown, context?: Record<string, unknown>): void;
	addBreadcrumb?(breadcrumb: {
		category: string;
		level: "debug" | "info" | "warning" | "error";
		message: string;
		data?: Record<string, unknown>;
	}): void;
}

export type WorkflowStatus =
	| "pending"
	| "running"
	| "success"
	| "error"
	| "cancelled";

export interface WorkflowStartOptions<I extends JsonValue> {
	id?: string;
	input: I;
	idempotencyKey?: string;
	queue?: string;
	maxAttempts?: number;
	runAt?: Date | number;
}

export interface RuntimeBootConfig {
	workflows: WorkflowDefinition<JsonValue, JsonValue>[];
	queues?: QueueDefinition[];
	startDispatcher?: boolean;
}

export interface WorkflowHandle<O extends JsonValue> {
	readonly id: string;
	result(options?: { timeoutMs?: number; pollIntervalMs?: number }): Promise<O>;
	cancel(): Promise<void>;
}
