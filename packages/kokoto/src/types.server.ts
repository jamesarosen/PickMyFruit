/** Terminal workflow status values stored in `_dc_workflow.status`. */
export type WorkflowStatus =
	| "pending"
	| "running"
	| "success"
	| "error"
	| "cancelled";

/** Step row status in `_dc_step`. */
export type StepStatus = "running" | "success" | "error";

export const PROTOCOL_VERSION = 1;

export const MAX_JSON_BYTES = 1_000_000;

export const DEFAULT_MAX_ATTEMPTS = 3;

export const DEFAULT_GLOBAL_CONCURRENCY = 32;

/** Heartbeat interval for executor liveness (ms). */
export const EXECUTOR_HEARTBEAT_MS = 2_000;

/** Reclaim foreign `running` rows when heartbeat is older than this multiplier × interval. */
export const EXECUTOR_STALE_HEARTBEAT_MULTIPLIER = 3;

/** Warn when a step's synchronous work exceeds this budget (ms). */
export const STEP_BUDGET_WARN_MS = 16;

export type WorkflowRow = {
	id: string;
	name: string;
	status: WorkflowStatus;
	queue: string | null;
	input: string;
	output: string | null;
	error: string | null;
	attempts: number;
	max_attempts: number;
	executor_id: string | null;
	scheduled_for: number;
	created_at: number;
	started_at: number | null;
	ended_at: number | null;
	idempotency_key: string | null;
	cancel_requested_at: number | null;
	protocol_version: number;
};

export type StepRow = {
	workflow_id: string;
	step_id: string;
	status: StepStatus;
	output: string | null;
	error: string | null;
	attempts: number;
	created_at: number;
	ended_at: number | null;
};
