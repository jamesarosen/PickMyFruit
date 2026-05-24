import type { Client, InValue } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { maxPayloadBytes } from "./schema.server.js";
import type {
	JsonValue,
	QueueDefinition,
	RuntimeBootConfig,
	RuntimeLogger,
	RuntimeTelemetry,
	StepOptions,
	WorkflowContext,
	WorkflowDefinition,
	WorkflowHandle,
	WorkflowStartOptions,
	WorkflowStatus,
} from "./types.server.js";

const defaultWorkerPool = "node-default";
const defaultGlobalConcurrency = 16;
const defaultPollIntervalMs = 500;
const defaultHeartbeatIntervalMs = 2_000;
const defaultHeartbeatTimeoutMs = 6_000;

const noopLogger: RuntimeLogger = {
	debug() {},
	info() {},
	warn() {},
};

const noopTelemetry: RuntimeTelemetry = {
	increment() {},
	distribution() {},
	captureException() {},
};

interface RuntimeOptions {
	client: Client;
	executorId?: string;
	workerPool?: string;
	globalConcurrency?: number;
	pollIntervalMs?: number;
	heartbeatIntervalMs?: number;
	heartbeatTimeoutMs?: number;
	now?: () => number;
	wakeOnEnqueue?: boolean;
	logger?: RuntimeLogger;
	telemetry?: RuntimeTelemetry;
}

interface WorkflowRow {
	id: string;
	name: string;
	status: WorkflowStatus;
	worker_pool: string;
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
}

interface StepRow {
	status: "running" | "success" | "error";
	output: string | null;
}

/** Thrown when a workflow observes cancellation at a step boundary. */
export class DurableCancelledError extends Error {
	constructor(message = "Workflow cancelled") {
		super(message);
		this.name = "DurableCancelledError";
	}
}

/** Thrown when a workflow reaches a terminal error state. */
export class DurableWorkflowError extends Error {
	constructor(
		message: string,
		readonly workflowId: string,
		readonly causePayload?: JsonValue,
	) {
		super(message);
		this.name = "DurableWorkflowError";
	}
}

/** Thrown when a payload exceeds kokoto's SQLite row safety budget. */
export class DurablePayloadError extends Error {
	constructor(label: string, size: number) {
		super(
			`${label} must be at most ${maxPayloadBytes} bytes, received ${size}`,
		);
		this.name = "DurablePayloadError";
	}
}

class DurableWorkflowContext implements WorkflowContext {
	readonly workflowId: string;
	readonly workflowName: string;
	readonly queue: string | null;
	private readonly startedAtMs: number;
	private readonly pendingSteps = new Set<Promise<unknown>>();
	private readonly activeStepIds = new Set<string>();

	constructor(
		private readonly runtime: Runtime,
		row: WorkflowRow,
	) {
		this.workflowId = row.id;
		this.workflowName = row.name;
		this.queue = row.queue;
		this.startedAtMs = row.started_at ?? runtime.now();
	}

	now(): Date {
		return new Date(this.startedAtMs);
	}

	stepKey(stepId: string): string {
		return `${this.workflowId}:${stepId}`;
	}

	async throwIfCancelled(): Promise<void> {
		const cancelRequested = await this.runtime.isCancellationRequested(
			this.workflowId,
		);
		if (cancelRequested) throw new DurableCancelledError();
	}

	step<T extends JsonValue>(
		stepId: string,
		fn: () => Promise<T> | T,
		options: StepOptions = {},
	): Promise<T> {
		if (this.activeStepIds.has(stepId)) {
			return Promise.reject(
				new Error(
					`Step "${stepId}" is already running for workflow ${this.workflowId}`,
				),
			);
		}
		this.activeStepIds.add(stepId);
		const pending = this.runStep(stepId, fn, options).finally(() => {
			this.activeStepIds.delete(stepId);
			this.pendingSteps.delete(pending);
		});
		this.pendingSteps.add(pending);
		return pending;
	}

	async waitForSettledSteps(): Promise<void> {
		await Promise.allSettled(this.pendingSteps);
	}

	private async runStep<T extends JsonValue>(
		stepId: string,
		fn: () => Promise<T> | T,
		options: StepOptions,
	): Promise<T> {
		await this.throwIfCancelled();
		const cached = await this.runtime.getSuccessfulStep(
			this.workflowId,
			stepId,
		);
		if (cached) {
			this.runtime.recordStepReplayed(this.workflowName, stepId);
			return parseJson(cached.output) as T;
		}

		await this.runtime.markStepRunning(this.workflowId, stepId);
		this.runtime.recordStepStarted(this.workflowName, stepId);
		const startedAt = this.runtime.now();
		try {
			const result = await fn();
			const elapsed = this.runtime.now() - startedAt;
			this.runtime.recordStepDuration(this.workflowName, stepId, elapsed);
			if (
				options.budgetWarnMs !== undefined &&
				elapsed > options.budgetWarnMs
			) {
				this.runtime.recordStepBudgetOverrun(
					this.workflowId,
					this.workflowName,
					stepId,
					elapsed,
					options.budgetWarnMs,
				);
			}
			await this.runtime.markStepSuccess(this.workflowId, stepId, result);
			this.runtime.recordStepFinished(this.workflowName, stepId);
			return result;
		} catch (error) {
			await this.runtime.markStepError(this.workflowId, stepId, error);
			this.runtime.recordStepFailed(this.workflowName, stepId);
			throw error;
		}
	}
}

/** Creates a SQLite-backed durable workflow runtime. */
export function createRuntime(options: RuntimeOptions): Runtime {
	return new Runtime(options);
}

export class Runtime {
	private readonly client: Client;
	private readonly executorId: string;
	private readonly workerPool: string;
	private readonly globalConcurrency: number;
	private readonly pollIntervalMs: number;
	private readonly heartbeatIntervalMs: number;
	private readonly heartbeatTimeoutMs: number;
	private readonly getNow: () => number;
	private readonly wakeOnEnqueue: boolean;
	private readonly logger: RuntimeLogger;
	private readonly telemetry: RuntimeTelemetry;
	private readonly workflows = new Map<
		string,
		WorkflowDefinition<JsonValue, JsonValue>
	>();
	private readonly queues = new Map<string, QueueDefinition>();
	private readonly activeByQueue = new Map<string, number>();
	private readonly running = new Set<Promise<void>>();
	private pollTimer: NodeJS.Timeout | undefined;
	private heartbeatTimer: NodeJS.Timeout | undefined;
	private started = false;
	private dispatcherHealthy = true;

	constructor(options: RuntimeOptions) {
		this.client = options.client;
		this.executorId = options.executorId ?? randomUUID();
		this.workerPool = options.workerPool ?? defaultWorkerPool;
		this.globalConcurrency =
			options.globalConcurrency ?? defaultGlobalConcurrency;
		this.pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
		this.heartbeatIntervalMs =
			options.heartbeatIntervalMs ?? defaultHeartbeatIntervalMs;
		this.heartbeatTimeoutMs =
			options.heartbeatTimeoutMs ?? defaultHeartbeatTimeoutMs;
		this.getNow = options.now ?? Date.now;
		this.wakeOnEnqueue = options.wakeOnEnqueue ?? true;
		this.logger = options.logger ?? noopLogger;
		this.telemetry = options.telemetry ?? noopTelemetry;
	}

	now(): number {
		return this.getNow();
	}

	async start(config: RuntimeBootConfig): Promise<void>;
	async start<I extends JsonValue, O extends JsonValue>(
		workflow: WorkflowDefinition<I, O>,
		options: WorkflowStartOptions<I>,
	): Promise<WorkflowHandle<O>>;
	async start<I extends JsonValue, O extends JsonValue>(
		configOrWorkflow: RuntimeBootConfig | WorkflowDefinition<I, O>,
		options?: WorkflowStartOptions<I>,
	): Promise<void | WorkflowHandle<O>> {
		if ("workflows" in configOrWorkflow) {
			await this.boot(configOrWorkflow);
			return;
		}
		if (!options) throw new Error("Workflow start options are required");
		return this.enqueue(configOrWorkflow, options);
	}

	async stop(): Promise<void> {
		if (this.pollTimer) clearInterval(this.pollTimer);
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		this.pollTimer = undefined;
		this.heartbeatTimer = undefined;
		this.started = false;
		await Promise.allSettled(this.running);
	}

	async cancel(workflowId: string): Promise<void> {
		const now = this.now();
		await this.execute(
			`UPDATE _dc_workflow
			 SET status = 'cancelled', ended_at = ?, cancel_requested_at = ?
			 WHERE id = ? AND status = 'pending'`,
			[now, now, workflowId],
		);
		await this.execute(
			`UPDATE _dc_workflow
			 SET cancel_requested_at = ?
			 WHERE id = ? AND status = 'running' AND cancel_requested_at IS NULL`,
			[now, workflowId],
		);
	}

	async tick(): Promise<number> {
		if (!this.dispatcherHealthy) return 0;
		await this.heartbeat();
		const claimed = await this.claimAvailable();
		if (claimed.length === 0) return 0;
		for (const row of claimed) {
			this.runClaimed(row);
		}
		return claimed.length;
	}

	/** Waits for currently running workflow tasks to settle. */
	async drain(): Promise<void> {
		await Promise.allSettled(this.running);
	}

	private async boot(config: RuntimeBootConfig): Promise<void> {
		for (const workflow of config.workflows)
			this.workflows.set(workflow.name, workflow);
		for (const queue of config.queues ?? []) this.queues.set(queue.name, queue);

		const now = this.now();
		await this.execute(
			`INSERT INTO _dc_executor (id, started_at, heartbeat_at)
			 VALUES (?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET started_at = excluded.started_at, heartbeat_at = excluded.heartbeat_at`,
			[this.executorId, now, now],
		);
		const quickCheck = await this.queryOne<{ quick_check: string }>(
			"PRAGMA quick_check",
		);
		if (quickCheck?.quick_check !== "ok") {
			this.dispatcherHealthy = false;
			this.telemetry.increment("kokoto.boot.quick_check_failed");
			throw new Error("SQLite quick_check failed");
		}
		await this.recoverStaleRunning();
		if (config.startDispatcher ?? true) {
			this.startTimers();
		}
		this.started = true;
		this.logger.info(
			{ executorId: this.executorId, workerPool: this.workerPool },
			"kokoto.runtime.started",
		);
	}

	private startTimers(): void {
		if (!this.pollTimer) {
			this.pollTimer = setInterval(() => {
				this.tick().catch((error: unknown) =>
					this.telemetry.captureException(error),
				);
			}, this.pollIntervalMs);
		}
		if (!this.heartbeatTimer) {
			this.heartbeatTimer = setInterval(() => {
				this.heartbeat().catch((error: unknown) =>
					this.telemetry.captureException(error),
				);
			}, this.heartbeatIntervalMs);
		}
	}

	private async enqueue<I extends JsonValue, O extends JsonValue>(
		workflow: WorkflowDefinition<I, O>,
		options: WorkflowStartOptions<I>,
	): Promise<WorkflowHandle<O>> {
		if (options.queue && this.started && !this.queues.has(options.queue)) {
			throw new Error(`Queue "${options.queue}" is not registered`);
		}
		const id = options.id ?? randomUUID();
		const now = this.now();
		const scheduledFor =
			options.runAt instanceof Date
				? options.runAt.getTime()
				: (options.runAt ?? 0);
		const input = stringifyPayload(options.input, "workflow input");
		const maxAttempts = options.maxAttempts ?? 3;
		try {
			await this.execute(
				`INSERT INTO _dc_workflow (
					id, name, status, worker_pool, queue, input, attempts, max_attempts,
					scheduled_for, created_at, idempotency_key, protocol_version
				)
				VALUES (?, ?, 'pending', ?, ?, ?, 0, ?, ?, ?, ?, 1)`,
				[
					id,
					workflow.name,
					this.workerPool,
					options.queue ?? null,
					input,
					maxAttempts,
					scheduledFor,
					now,
					options.idempotencyKey ?? null,
				],
			);
		} catch (error) {
			if (!options.idempotencyKey || !isUniqueConstraintError(error))
				throw error;
		}
		const canonicalId =
			options.idempotencyKey === undefined
				? id
				: await this.lookupWorkflowIdByIdempotencyKey(options.idempotencyKey);
		this.telemetry.increment("kokoto.workflow.enqueued", {
			"workflow.name": workflow.name,
			queue: options.queue ?? "none",
		});
		if (this.wakeOnEnqueue) void this.tick();
		return this.createHandle<O>(canonicalId);
	}

	private createHandle<O extends JsonValue>(id: string): WorkflowHandle<O> {
		return {
			id,
			result: (options) => this.waitForResult<O>(id, options),
			cancel: () => this.cancel(id),
		};
	}

	private async waitForResult<O extends JsonValue>(
		id: string,
		options: { timeoutMs?: number; pollIntervalMs?: number } = {},
	): Promise<O> {
		const timeoutMs = options.timeoutMs ?? 60_000;
		const pollIntervalMs = options.pollIntervalMs ?? 50;
		const deadline = this.now() + timeoutMs;
		while (this.now() <= deadline) {
			const row = await this.getWorkflow(id);
			if (!row) throw new DurableWorkflowError("Workflow not found", id);
			if (row.status === "success") return parseJson(row.output) as O;
			if (row.status === "cancelled") throw new DurableCancelledError();
			if (row.status === "error") {
				throw new DurableWorkflowError(
					`Workflow ${id} failed`,
					id,
					row.error ? parseJson(row.error) : undefined,
				);
			}
			await delay(pollIntervalMs);
		}
		throw new DurableWorkflowError(`Workflow ${id} timed out`, id);
	}

	private async lookupWorkflowIdByIdempotencyKey(
		idempotencyKey: string,
	): Promise<string> {
		const row = await this.queryOne<{ id: string }>(
			"SELECT id FROM _dc_workflow WHERE idempotency_key = ?",
			[idempotencyKey],
		);
		if (!row) throw new Error("Idempotency key conflict could not be resolved");
		return row.id;
	}

	private async claimAvailable(): Promise<WorkflowRow[]> {
		return this.transaction(async () => {
			const capacity = this.globalConcurrency - this.running.size;
			if (capacity <= 0) return [];
			const candidates = await this.query<WorkflowRow>(
				`SELECT *
				 FROM _dc_workflow
				 WHERE status = 'pending'
				   AND scheduled_for <= ?
				   AND worker_pool = ?
				 ORDER BY scheduled_for ASC, created_at ASC
				 LIMIT ?`,
				[this.now(), this.workerPool, capacity * 4],
			);
			const claimed: WorkflowRow[] = [];
			for (const row of candidates) {
				if (claimed.length >= capacity) break;
				if (!this.hasQueueCapacity(row.queue)) continue;
				const startedAt = this.now();
				const result = await this.execute(
					`UPDATE _dc_workflow
					 SET status = 'running',
					     attempts = attempts + 1,
					     executor_id = ?,
					     started_at = ?,
					     cancel_requested_at = NULL
					 WHERE id = ? AND status = 'pending'`,
					[this.executorId, startedAt, row.id],
				);
				if (result.rowsAffected === 0) continue;
				claimed.push({
					...row,
					status: "running",
					attempts: row.attempts + 1,
					executor_id: this.executorId,
					started_at: startedAt,
					cancel_requested_at: null,
				});
				this.reserveQueue(row.queue);
			}
			if (claimed.length > 0) {
				this.telemetry.increment("kokoto.dispatch.claimed", {
					queue: claimed[0]?.queue ?? "none",
				});
			}
			return claimed;
		});
	}

	private runClaimed(row: WorkflowRow): void {
		const pending = this.executeWorkflow(row)
			.catch((error: unknown) => this.telemetry.captureException(error))
			.finally(() => {
				this.releaseQueue(row.queue);
				this.running.delete(pending);
			});
		this.running.add(pending);
	}

	private async executeWorkflow(row: WorkflowRow): Promise<void> {
		const workflow = this.workflows.get(row.name);
		this.telemetry.increment("kokoto.workflow.dispatched", {
			"workflow.name": row.name,
			queue: row.queue ?? "none",
		});
		this.logger.info(
			{ workflowId: row.id, name: row.name, status: "running" },
			"workflow.transition",
		);
		if (!workflow) {
			await this.finalizeError(
				row,
				new Error(`Workflow "${row.name}" is not registered`),
			);
			return;
		}
		const ctx = new DurableWorkflowContext(this, row);
		try {
			const output = await workflow.handler(ctx, parseJson(row.input));
			await ctx.waitForSettledSteps();
			await this.finalizeSuccess(row, output);
		} catch (error) {
			await ctx.waitForSettledSteps();
			if (error instanceof DurableCancelledError) {
				await this.finalizeCancelled(row);
			} else if (row.attempts >= row.max_attempts) {
				await this.finalizeError(row, error);
			} else {
				await this.retryLater(row, error);
			}
		}
	}

	private async finalizeSuccess(
		row: WorkflowRow,
		output: JsonValue,
	): Promise<void> {
		const now = this.now();
		await this.execute(
			`UPDATE _dc_workflow
			 SET status = 'success', output = ?, error = NULL, ended_at = ?
			 WHERE id = ?`,
			[stringifyPayload(output, "workflow output"), now, row.id],
		);
		this.recordWorkflowFinished(row, "success");
	}

	private async finalizeCancelled(row: WorkflowRow): Promise<void> {
		const now = this.now();
		await this.execute(
			`UPDATE _dc_workflow
			 SET status = 'cancelled', ended_at = ?, cancel_requested_at = COALESCE(cancel_requested_at, ?)
			 WHERE id = ?`,
			[now, now, row.id],
		);
		this.recordWorkflowFinished(row, "cancelled");
	}

	private async finalizeError(row: WorkflowRow, error: unknown): Promise<void> {
		const now = this.now();
		await this.execute(
			`UPDATE _dc_workflow
			 SET status = 'error', error = ?, ended_at = ?
			 WHERE id = ?`,
			[stringifyPayload(errorToJson(error), "workflow error"), now, row.id],
		);
		this.telemetry.captureException(error, {
			workflowId: row.id,
			workflowName: row.name,
		});
		this.recordWorkflowFinished(row, "error");
	}

	private async retryLater(row: WorkflowRow, error: unknown): Promise<void> {
		await this.execute(
			`UPDATE _dc_workflow
			 SET status = 'pending', executor_id = NULL, started_at = NULL, error = ?
			 WHERE id = ?`,
			[stringifyPayload(errorToJson(error), "workflow error"), row.id],
		);
	}

	private recordWorkflowFinished(row: WorkflowRow, status: string): void {
		this.telemetry.increment("kokoto.workflow.finished", {
			"workflow.name": row.name,
			queue: row.queue ?? "none",
			status,
		});
		this.logger.info(
			{ workflowId: row.id, name: row.name, status },
			"workflow.transition",
		);
	}

	async isCancellationRequested(workflowId: string): Promise<boolean> {
		const row = await this.queryOne<{ cancel_requested_at: number | null }>(
			"SELECT cancel_requested_at FROM _dc_workflow WHERE id = ?",
			[workflowId],
		);
		return (
			row?.cancel_requested_at !== null &&
			row?.cancel_requested_at !== undefined
		);
	}

	async getSuccessfulStep(
		workflowId: string,
		stepId: string,
	): Promise<StepRow | undefined> {
		const row = await this.queryOne<StepRow>(
			`SELECT status, output
			 FROM _dc_step
			 WHERE workflow_id = ? AND step_id = ? AND status = 'success'`,
			[workflowId, stepId],
		);
		return row ?? undefined;
	}

	async markStepRunning(workflowId: string, stepId: string): Promise<void> {
		const now = this.now();
		await this.execute(
			`INSERT INTO _dc_step (
				workflow_id, step_id, status, attempts, started_at, ended_at
			)
			VALUES (?, ?, 'running', 1, ?, NULL)
			ON CONFLICT(workflow_id, step_id) DO UPDATE SET
				status = 'running',
				attempts = _dc_step.attempts + 1,
				started_at = excluded.started_at,
				ended_at = NULL,
				error = NULL
			WHERE _dc_step.status <> 'success'`,
			[workflowId, stepId, now],
		);
	}

	async markStepSuccess(
		workflowId: string,
		stepId: string,
		output: JsonValue,
	): Promise<void> {
		await this.execute(
			`UPDATE _dc_step
			 SET status = 'success', output = ?, error = NULL, ended_at = ?
			 WHERE workflow_id = ? AND step_id = ?`,
			[stringifyPayload(output, "step output"), this.now(), workflowId, stepId],
		);
	}

	async markStepError(
		workflowId: string,
		stepId: string,
		error: unknown,
	): Promise<void> {
		await this.execute(
			`UPDATE _dc_step
			 SET status = 'error', error = ?, ended_at = ?
			 WHERE workflow_id = ? AND step_id = ?`,
			[
				stringifyPayload(errorToJson(error), "step error"),
				this.now(),
				workflowId,
				stepId,
			],
		);
	}

	recordStepStarted(workflowName: string, stepId: string): void {
		this.telemetry.increment("kokoto.step.started", {
			"workflow.name": workflowName,
			"step.name": stepId,
		});
	}

	recordStepFinished(workflowName: string, stepId: string): void {
		this.telemetry.increment("kokoto.step.finished", {
			"workflow.name": workflowName,
			"step.name": stepId,
		});
	}

	recordStepFailed(workflowName: string, stepId: string): void {
		this.telemetry.increment("kokoto.step.failed", {
			"workflow.name": workflowName,
			"step.name": stepId,
		});
	}

	recordStepReplayed(workflowName: string, stepId: string): void {
		this.telemetry.increment("kokoto.step.replayed", {
			"workflow.name": workflowName,
			"step.name": stepId,
		});
	}

	recordStepDuration(
		workflowName: string,
		stepId: string,
		durationMs: number,
	): void {
		this.telemetry.distribution("kokoto.step.duration_ms", durationMs, {
			"workflow.name": workflowName,
			"step.name": stepId,
		});
	}

	recordStepBudgetOverrun(
		workflowId: string,
		workflowName: string,
		stepId: string,
		durationMs: number,
		budgetWarnMs: number,
	): void {
		this.telemetry.addBreadcrumb?.({
			category: "kokoto",
			level: "warning",
			message: "Step exceeded CPU budget warning",
			data: { workflowName, stepId, durationMs, budgetWarnMs },
		});
		this.logger.warn(
			{
				workflowId,
				name: workflowName,
				step: stepId,
				durationMs,
				budgetWarnMs,
			},
			"kokoto.step.budget_overrun",
		);
	}

	private hasQueueCapacity(queue: string | null): boolean {
		if (!queue) return true;
		const limit = this.queues.get(queue)?.concurrency ?? 1;
		return (this.activeByQueue.get(queue) ?? 0) < limit;
	}

	private reserveQueue(queue: string | null): void {
		if (!queue) return;
		this.activeByQueue.set(queue, (this.activeByQueue.get(queue) ?? 0) + 1);
	}

	private releaseQueue(queue: string | null): void {
		if (!queue) return;
		const next = Math.max((this.activeByQueue.get(queue) ?? 1) - 1, 0);
		if (next === 0) this.activeByQueue.delete(queue);
		else this.activeByQueue.set(queue, next);
	}

	private async recoverStaleRunning(): Promise<void> {
		const staleBefore = this.now() - this.heartbeatTimeoutMs;
		const result = await this.execute(
			`UPDATE _dc_workflow
			 SET status = 'pending', executor_id = NULL, started_at = NULL
			 WHERE status = 'running'
			   AND worker_pool = ?
			   AND (executor_id IS NULL OR executor_id <> ?)
			   AND (
				 executor_id IS NULL
				 OR executor_id NOT IN (
					SELECT id FROM _dc_executor WHERE heartbeat_at >= ?
				 )
			   )`,
			[this.workerPool, this.executorId, staleBefore],
		);
		if (result.rowsAffected > 0) {
			this.telemetry.increment("kokoto.workflow.recovered", {
				"workflow.name": "unknown",
			});
		}
	}

	private async heartbeat(): Promise<void> {
		await this.execute(
			"UPDATE _dc_executor SET heartbeat_at = ? WHERE id = ?",
			[this.now(), this.executorId],
		);
	}

	private async getWorkflow(id: string): Promise<WorkflowRow | undefined> {
		const row = await this.queryOne<WorkflowRow>(
			"SELECT * FROM _dc_workflow WHERE id = ?",
			[id],
		);
		return row ?? undefined;
	}

	private async transaction<T>(fn: () => Promise<T>): Promise<T> {
		await this.client.execute("BEGIN IMMEDIATE");
		try {
			const result = await fn();
			await this.client.execute("COMMIT");
			return result;
		} catch (error) {
			await this.client.execute("ROLLBACK");
			throw error;
		}
	}

	private async execute(sql: string, args: InValue[] = []) {
		return this.client.execute({ sql, args });
	}

	private async query<T extends object>(
		sql: string,
		args: InValue[] = [],
	): Promise<T[]> {
		const result = await this.execute(sql, args);
		return result.rows as unknown as T[];
	}

	private async queryOne<T extends object>(
		sql: string,
		args: InValue[] = [],
	): Promise<T | undefined> {
		return (await this.query<T>(sql, args))[0];
	}
}

function stringifyPayload(value: JsonValue, label: string): string {
	const json = JSON.stringify(value);
	const size = Buffer.byteLength(json, "utf8");
	if (size > maxPayloadBytes) throw new DurablePayloadError(label, size);
	return json;
}

function parseJson(value: string | null): JsonValue {
	if (value === null) return null;
	return JSON.parse(value) as JsonValue;
}

function errorToJson(error: unknown): JsonValue {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
			stack: error.stack ?? null,
		};
	}
	return { name: "Error", message: String(error), stack: null };
}

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /unique|constraint/i.test(error.message);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
