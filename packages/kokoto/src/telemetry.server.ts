type MetricAttributes = Record<string, string | number | boolean>;

type MetricsApi = {
	count: (
		name: string,
		value: number,
		options?: { attributes?: MetricAttributes },
	) => void;
	distribution: (
		name: string,
		value: number,
		options?: { attributes?: MetricAttributes },
	) => void;
};

type SentryLike = {
	metrics?: MetricsApi;
	startSpan?: <T>(
		options: { name: string; op: string; attributes?: MetricAttributes },
		fn: () => T | Promise<T>,
	) => T | Promise<T>;
	captureException?: (
		error: unknown,
		context?: { fingerprint?: string[] },
	) => void;
	addBreadcrumb?: (breadcrumb: {
		category: string;
		message: string;
		level: string;
		data?: Record<string, unknown>;
	}) => void;
};

let sentry: SentryLike | undefined;
let logger:
	| {
			info: (fields: Record<string, unknown>, msg: string) => void;
			warn: (fields: Record<string, unknown>, msg: string) => void;
	  }
	| undefined;

/** Injects optional Sentry and Pino implementations from the host app. */
export function configureTelemetry(options: {
	sentry?: SentryLike;
	logger?: typeof logger;
}): void {
	sentry = options.sentry;
	logger = options.logger;
}

function count(
	metric: string,
	value: number,
	attributes?: MetricAttributes,
): void {
	sentry?.metrics?.count(
		metric,
		value,
		attributes ? { attributes } : undefined,
	);
}

function distribution(
	metric: string,
	value: number,
	attributes?: MetricAttributes,
): void {
	sentry?.metrics?.distribution(
		metric,
		value,
		attributes ? { attributes } : undefined,
	);
}

export function recordWorkflowEnqueued(
	workflowName: string,
	queue: string | undefined,
): void {
	count("kokoto.workflow.enqueued", 1, {
		"workflow.name": workflowName,
		queue: queue ?? "none",
	});
	logger?.info(
		{ workflowName, queue: queue ?? "none", transition: "enqueued" },
		"workflow.transition",
	);
}

export function recordWorkflowDispatched(
	workflowName: string,
	queue: string | undefined,
): void {
	count("kokoto.workflow.dispatched", 1, {
		"workflow.name": workflowName,
		queue: queue ?? "none",
	});
	logger?.info(
		{ workflowName, queue: queue ?? "none", transition: "dispatched" },
		"workflow.transition",
	);
}

export function recordWorkflowFinished(
	workflowName: string,
	queue: string | undefined,
	status: "success" | "error" | "cancelled",
): void {
	count("kokoto.workflow.finished", 1, {
		"workflow.name": workflowName,
		queue: queue ?? "none",
		status,
	});
	logger?.info(
		{ workflowName, queue: queue ?? "none", status, transition: "finished" },
		"workflow.transition",
	);
}

export function recordWorkflowRecovered(workflowName: string): void {
	count("kokoto.workflow.recovered", 1, { "workflow.name": workflowName });
}

export function recordWorkflowReplay(workflowName: string): void {
	count("kokoto.workflow.replay", 1, { "workflow.name": workflowName });
}

export function recordStepStarted(
	workflowName: string,
	stepName: string,
): void {
	count("kokoto.step.started", 1, {
		"workflow.name": workflowName,
		"step.name": stepName,
	});
}

export function recordStepFinished(
	workflowName: string,
	stepName: string,
): void {
	count("kokoto.step.finished", 1, {
		"workflow.name": workflowName,
		"step.name": stepName,
	});
}

export function recordStepFailed(workflowName: string, stepName: string): void {
	count("kokoto.step.failed", 1, {
		"workflow.name": workflowName,
		"step.name": stepName,
	});
}

export function recordStepReplayed(
	workflowName: string,
	stepName: string,
): void {
	count("kokoto.step.replayed", 1, {
		"workflow.name": workflowName,
		"step.name": stepName,
	});
}

export function recordDispatchClaimed(
	queue: string | undefined,
	rows: number,
): void {
	count("kokoto.dispatch.claimed", rows, { queue: queue ?? "global" });
}

export function recordQuickCheckFailed(): void {
	count("kokoto.boot.quick_check_failed", 1);
}

export function recordStepDuration(
	workflowName: string,
	stepName: string,
	durationMs: number,
): void {
	distribution("kokoto.step.duration_ms", durationMs, {
		"workflow.name": workflowName,
		"step.name": stepName,
	});
}

export async function withStepSpan<T>(
	workflowName: string,
	stepName: string,
	fn: () => Promise<T>,
): Promise<T> {
	if (!sentry?.startSpan) return fn();
	return sentry.startSpan(
		{
			name: `kokoto.step.${stepName}`,
			op: "kokoto.step",
			attributes: { "workflow.name": workflowName, "step.name": stepName },
		},
		fn,
	);
}

export function captureStepException(
	workflowName: string,
	stepName: string,
	error: unknown,
): void {
	sentry?.captureException?.(error, {
		fingerprint: ["kokoto", workflowName, stepName],
	});
}

export function addStepBudgetBreadcrumb(
	workflowName: string,
	stepName: string,
	durationMs: number,
): void {
	sentry?.addBreadcrumb?.({
		category: "kokoto",
		message: "step.budget_exceeded",
		level: "warning",
		data: { workflowName, stepName, durationMs },
	});
}
