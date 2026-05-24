import type { Client } from "@libsql/client";
import { DurableCancelledError } from "./errors.server.js";
import { parsePayload } from "./json.server.js";
import * as store from "./store.server.js";
import {
	addStepBudgetBreadcrumb,
	captureStepException,
	recordStepDuration,
	recordStepFailed,
	recordStepFinished,
	recordStepReplayed,
	recordStepStarted,
	withStepSpan,
} from "./telemetry.server.js";
import { STEP_BUDGET_WARN_MS } from "./types.server.js";

export type StepFn<T> = () => T | Promise<T>;

type ActiveStep = {
	name: string;
	promise: Promise<unknown>;
};

/** Workflow execution context passed to workflow handlers. */
export class WorkflowContext {
	readonly workflowId: string;
	readonly workflowName: string;
	private readonly anchorMs: number;
	private stepCounter = 0;
	private readonly activeSteps = new Set<ActiveStep>();
	private cancelled = false;

	constructor(
		private readonly client: Client,
		options: {
			workflowId: string;
			workflowName: string;
			startedAtMs: number;
			cancelRequestedAt: number | null;
		},
	) {
		this.workflowId = options.workflowId;
		this.workflowName = options.workflowName;
		this.anchorMs = options.startedAtMs;
		if (options.cancelRequestedAt != null) this.cancelled = true;
	}

	/** Deterministic clock based on workflow claim time (not wall clock). */
	now(): number {
		return this.anchorMs;
	}

	/** Stable idempotency string for external APIs: workflow id + step name. */
	stepKey(stepName: string): string {
		return `${this.workflowId}:${stepName}`;
	}

	private async assertNotCancelled(): Promise<void> {
		if (this.cancelled) {
			throw new DurableCancelledError(this.workflowId);
		}
		const row = await store.getWorkflow(this.client, this.workflowId);
		if (row?.cancel_requested_at != null) {
			this.cancelled = true;
			throw new DurableCancelledError(this.workflowId);
		}
	}

	/** Runs a named step with replay from `_dc_step` when already successful. */
	async step<T>(name: string, fn: StepFn<T>): Promise<T> {
		await this.assertNotCancelled();
		const stepId = `${++this.stepCounter}:${name}`;

		const existing = await store.getStep(this.client, this.workflowId, stepId);
		if (existing?.status === "success" && existing.output != null) {
			recordStepReplayed(this.workflowName, name);
			return parsePayload<T>(existing.output) as T;
		}

		const active: ActiveStep = { name, promise: Promise.resolve() };
		this.activeSteps.add(active);

		const run = async (): Promise<T> => {
			recordStepStarted(this.workflowName, name);
			const syncStart = performance.now();
			try {
				const result = await withStepSpan(this.workflowName, name, async () => {
					const value = await fn();
					const syncMs = performance.now() - syncStart;
					if (syncMs > STEP_BUDGET_WARN_MS) {
						addStepBudgetBreadcrumb(this.workflowName, name, syncMs);
					}
					recordStepDuration(this.workflowName, name, syncMs);
					return value;
				});
				await store.upsertStepSuccess(this.client, {
					workflowId: this.workflowId,
					stepId,
					output: result,
				});
				recordStepFinished(this.workflowName, name);
				return result;
			} catch (err) {
				await store.upsertStepError(this.client, {
					workflowId: this.workflowId,
					stepId,
					error: err,
				});
				recordStepFailed(this.workflowName, name);
				captureStepException(this.workflowName, name, err);
				throw err;
			}
		};

		active.promise = run();
		try {
			return (await active.promise) as T;
		} finally {
			this.activeSteps.delete(active);
		}
	}

	/** Waits for sibling steps started via `Promise.all` before workflow finalization. */
	async drainActiveSteps(): Promise<void> {
		const pending = [...this.activeSteps];
		await Promise.allSettled(pending.map((s) => s.promise));
	}
}
