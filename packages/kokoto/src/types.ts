/**
 * Public types for the kokoto durable workflow runtime.
 */

/** Lifecycle status of a single workflow row. */
export type WorkflowStatus =
	| 'pending'
	| 'running'
	| 'success'
	| 'error'
	| 'cancelled'

/** Lifecycle status of a single `_dc_step` row. */
export type StepStatus = 'success' | 'error'

/**
 * Subset of libsql's `InValue` — the set of JS values that can be bound to a
 * SQLite prepared statement parameter. Kept structurally identical to
 * `@libsql/client`'s `InValue` so a `Client` is assignable to {@link SqlClient}
 * without a cast.
 */
export type SqlBindable =
	| null
	| string
	| number
	| bigint
	| boolean
	| Uint8Array
	| ArrayBuffer
	| Date

/** Positional or named arguments for a single prepared statement. */
export type SqlArgs = ReadonlyArray<SqlBindable> | Record<string, SqlBindable>

/** A SQL statement plus optional bound arguments. */
export interface SqlStatement {
	sql: string
	args?: SqlArgs
}

/**
 * Minimal libsql-compatible client surface used by the runtime. Kept structural
 * so the package does not have to depend on @libsql/client directly — the host
 * app passes in its own connection. `transaction()` is optional because the
 * runtime falls back to `execute()` when a caller does not need same-DB
 * atomicity (i.e. `ctx.step()` rather than `ctx.txStep()`).
 */
export interface SqlClient {
	execute(queryOrStatement: string | SqlStatement): Promise<SqlResult>
	transaction?: () => Promise<SqlTransaction>
}

export interface SqlResult {
	rows: Array<Record<string, unknown>>
	rowsAffected: number
}

export interface SqlTransaction {
	execute(queryOrStatement: string | SqlStatement): Promise<SqlResult>
	commit(): Promise<void>
	rollback(): Promise<void>
	close(): void
}

/**
 * Optional observability sink. Defaults are no-ops so the package works without
 * Sentry or pino installed; the host app injects real implementations.
 */
export interface KokotoTelemetry {
	/** Increment a counter metric. */
	incrementCounter?: (
		name: string,
		value: number,
		attributes?: Record<string, string | number>
	) => void
	/** Record a distribution sample (e.g. step duration in ms). */
	recordDistribution?: (
		name: string,
		value: number,
		attributes?: Record<string, string | number>
	) => void
	/** Report a caught exception. */
	captureException?: (
		err: unknown,
		ctx?: { workflow?: string; step?: string }
	) => void
	/** Structured info log. */
	logInfo?: (fields: Record<string, unknown>, msg: string) => void
	/** Structured debug log. */
	logDebug?: (fields: Record<string, unknown>, msg: string) => void
	/** Structured warning log. */
	logWarn?: (fields: Record<string, unknown>, msg: string) => void
}

/** Context object passed to workflow bodies. */
export interface WorkflowContext {
	/** Workflow id (PK). Stable across replays. */
	readonly workflowId: string
	/** Registered workflow name. */
	readonly workflowName: string
	/** Number of times this workflow has been dispatched (1-indexed). */
	readonly attempt: number
	/**
	 * Wall-clock time at the moment the workflow was first claimed
	 * (`workflow.started_at`). Returned as ms-since-epoch. Deterministic across
	 * replays — workflow bodies must use this rather than `Date.now()`.
	 */
	now(): number
	/**
	 * Stable per-step idempotency key suitable for forwarding to external
	 * providers (e.g. Resend `Idempotency-Key`). Computed from the workflow id
	 * and step name.
	 */
	stepKey(name: string): string
	/**
	 * Run an idempotent unit of work whose output is stored in the durable
	 * step log. On replay the cached output is returned and `fn` is not invoked.
	 *
	 * Errors are **not** persisted: a thrown step is replayed from scratch on
	 * the workflow's next dispatch. Only success is durable.
	 */
	step<T>(name: string, fn: () => Promise<T> | T): Promise<T>
	/**
	 * Run a same-DB step whose write and its `_dc_step` row commit in one
	 * libSQL transaction. Use this when the step's only effect is a write
	 * against the same database kokoto owns: the user write and the step row
	 * become atomic, eliminating the at-least-once duplicate-row hazard. The
	 * step `fn` receives a `SqlTransaction`; all writes must go through it.
	 *
	 * Errors throw and the transaction rolls back — both the user write and
	 * the step row disappear, so the next attempt re-runs the step cleanly.
	 *
	 * Requires the host `SqlClient` to expose `transaction()` (libsql does).
	 */
	txStep<T>(name: string, fn: (tx: SqlTransaction) => Promise<T> | T): Promise<T>
}

/** A workflow body — must be deterministic outside of `ctx.step()` boundaries. */
export type WorkflowFn<Input, Output> = (
	ctx: WorkflowContext,
	input: Input
) => Promise<Output>

/** Handle returned from `runtime.start()`. */
export interface WorkflowHandle<Output> {
	/** Workflow row primary key (UUIDv7 unless caller supplied one). */
	readonly id: string
	/** Registered workflow name. */
	readonly name: string
	/**
	 * Wait for the workflow to reach a terminal status. Throws the recorded
	 * error on `error`, a `DurableCancelledError` on `cancelled`. Resolves with
	 * stored output on `success`. Polls the `_dc_workflow` row every `pollMs`.
	 */
	result(opts?: { timeoutMs?: number; pollMs?: number }): Promise<Output>
	/** Request cancellation. See {@link DurableRuntime.cancel}. */
	cancel(): Promise<void>
	/** Fetch the latest stored status without waiting. */
	status(): Promise<WorkflowStatus>
}

/** Options for `runtime.start(workflow, opts)`. */
export interface StartWorkflowOptions {
	/** Workflow id (caller-supplied). Defaults to a UUIDv7. */
	id?: string
	/** SQL-side dedup key (UNIQUE). On conflict the existing row's id is reused. */
	idempotencyKey?: string
	/** Queue name to route through; defaults to the workflow's `defaultQueue`. */
	queue?: string
	/** Earliest ms-since-epoch the workflow may dispatch. Default: now. */
	runAt?: number
	/** Override the workflow's `defaultMaxAttempts`. */
	maxAttempts?: number
}

/** Definition object returned by {@link defineWorkflow}. */
export interface WorkflowDefinition<Input, Output> {
	readonly name: string
	readonly fn: WorkflowFn<Input, Output>
	readonly defaultQueue?: string
	readonly defaultMaxAttempts: number
}

/** Definition object returned by {@link defineQueue}. */
export interface QueueDefinition {
	readonly name: string
	readonly concurrency: number
}

export interface DefineWorkflowOptions {
	/** Default queue name to enqueue this workflow on. */
	queue?: string
	/** Default maximum dispatch attempts before the workflow is poisoned. */
	maxAttempts?: number
}

export interface DefineQueueOptions {
	/** Max concurrent in-flight workflows on this queue. Must be ≥1. */
	concurrency: number
}

/** Configuration for {@link createRuntime}. */
export interface RuntimeConfig {
	/** Open libsql connection. */
	client: SqlClient
	/** Optional observability sink. */
	telemetry?: KokotoTelemetry
	/** Dispatcher poll interval (ms). Default 250ms. */
	pollMs?: number
	/** Hard global concurrency cap across all queues. Default 16. */
	globalConcurrency?: number
	/** Identifier for the host process; defaults to a UUIDv7. */
	executorId?: string
}

/** Configuration for {@link DurableRuntime.start}. */
export interface RuntimeStartConfig {
	workflows: ReadonlyArray<WorkflowDefinition<any, any>>
	queues?: ReadonlyArray<QueueDefinition>
}
