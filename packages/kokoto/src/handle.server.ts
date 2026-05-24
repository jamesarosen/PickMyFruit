import type { Client } from "@libsql/client";
import { DurableTimeoutError } from "./errors.server.js";
import { parsePayload } from "./json.server.js";
import * as store from "./store.server.js";
import type { WorkflowStatus } from "./types.server.js";

const TERMINAL: WorkflowStatus[] = ["success", "error", "cancelled"];

/** Client-visible handle for a started workflow. */
export class WorkflowHandle<TOutput = unknown> {
	constructor(
		readonly id: string,
		private readonly client: Client,
		private readonly wake: () => void,
	) {}

	/** Polls until the workflow reaches a terminal status or times out. */
	async result(options?: { timeout?: number }): Promise<TOutput> {
		const timeout = options?.timeout ?? 60_000;
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			const row = await store.getWorkflow(this.client, this.id);
			if (!row) {
				throw new Error(`Workflow ${this.id} not found`);
			}
			if (TERMINAL.includes(row.status)) {
				if (row.status === "success") {
					return parsePayload<TOutput>(row.output) as TOutput;
				}
				if (row.status === "cancelled") {
					throw new Error(`Workflow ${this.id} was cancelled`);
				}
				const errPayload = parsePayload<{ message?: string }>(row.error);
				throw new Error(errPayload?.message ?? `Workflow ${this.id} failed`);
			}
			this.wake();
			await sleep(50);
		}
		throw new DurableTimeoutError(this.id, timeout);
	}

	/** Requests cancellation for pending or running workflows. */
	async cancel(): Promise<boolean> {
		const row = await store.getWorkflow(this.client, this.id);
		if (!row) return false;
		if (row.status === "pending") {
			const ok = await store.cancelPending(this.client, this.id);
			if (ok) this.wake();
			return ok;
		}
		if (row.status === "running") {
			return store.requestCancelRunning(this.client, this.id);
		}
		return false;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
