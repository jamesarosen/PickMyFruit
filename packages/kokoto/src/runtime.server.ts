import type { Client } from "@libsql/client";
import { randomUUID } from "node:crypto";
import { Dispatcher } from "./dispatcher.server.js";
import { WorkflowHandle } from "./handle.server.js";
import {
	configureTelemetry,
	recordQuickCheckFailed,
	recordWorkflowRecovered,
} from "./telemetry.server.js";
import type { WorkflowDefinition } from "./workflow.server.js";
import { defineQueue, type QueueDefinition } from "./queue.server.js";
import { registerWorkflow } from "./registry.server.js";
import * as store from "./store.server.js";

export type RuntimeStartOptions = {
	client: Client;
	queues?: QueueDefinition[];
	workflows?: WorkflowDefinition<unknown, unknown>[];
	globalConcurrency?: number;
	sentry?: Parameters<typeof configureTelemetry>[0]["sentry"];
	logger?: Parameters<typeof configureTelemetry>[0]["logger"];
};

export type EnqueueOptions<TInput> = {
	input: TInput;
	id?: string;
	idempotencyKey?: string;
	queue?: string;
	runAt?: Date | number;
	maxAttempts?: number;
};

/** Kokoto durable runtime singleton for the Node process. */
class KokotoRuntime {
	private client: Client | undefined;
	private dispatcher: Dispatcher | undefined;
	private executorId: string | undefined;
	private started = false;
	private quickCheckOk = true;

	/** Configures telemetry without starting the dispatcher. */
	configureTelemetry(options: {
		sentry?: RuntimeStartOptions["sentry"];
		logger?: RuntimeStartOptions["logger"];
	}): void {
		configureTelemetry(options);
	}

	/** Boots the executor, recovery, and dispatcher loop. */
	async start(options: RuntimeStartOptions): Promise<void> {
		if (this.started) await this.stop();
		this.client = options.client;
		configureTelemetry({
			sentry: options.sentry,
			logger: options.logger,
		});

		for (const queue of options.queues ?? []) {
			defineQueue(queue.name, { concurrency: queue.concurrency });
		}
		for (const workflow of options.workflows ?? []) {
			registerWorkflow(workflow);
		}

		await this.client.execute("PRAGMA busy_timeout = 5000");

		this.quickCheckOk = await store.runQuickCheck(this.client);
		if (!this.quickCheckOk) {
			recordQuickCheckFailed();
			return;
		}

		this.executorId = randomUUID();
		await store.insertExecutor(this.client, this.executorId);

		const recovered = await store.recoverForeignRunning(
			this.client,
			this.executorId,
		);
		for (const row of recovered) {
			recordWorkflowRecovered(row.name);
		}

		this.dispatcher = new Dispatcher({
			client: this.client,
			executorId: this.executorId,
			globalConcurrency: options.globalConcurrency,
		});
		this.dispatcher.startHeartbeat();
		this.started = true;
		this.dispatcher.wake();
	}

	/** Stops the dispatcher; in-flight steps may complete or replay on next boot. */
	async stop(): Promise<void> {
		if (this.dispatcher) {
			this.dispatcher.stop();
			await this.dispatcher.drain();
		}
		this.dispatcher = undefined;
		this.started = false;
		this.executorId = undefined;
		this.client = undefined;
	}

	/** Signals the dispatcher to claim pending work (tests and internal use). */
	wake(): void {
		this.dispatcher?.wake();
	}

	/** Enqueues a workflow and returns a handle for awaiting the result. */
	async startWorkflow<TInput, TOutput>(
		workflow: WorkflowDefinition<TInput, TOutput>,
		options: EnqueueOptions<TInput>,
	): Promise<WorkflowHandle<TOutput>> {
		if (!this.client || !this.dispatcher || !this.quickCheckOk) {
			throw new Error("Kokoto runtime is not started or failed quick_check");
		}

		const id = options.id ?? randomUUID();
		const scheduledFor =
			options.runAt === undefined
				? 0
				: typeof options.runAt === "number"
					? options.runAt
					: options.runAt.getTime();

		const { id: workflowId, created } = await store.insertWorkflow(
			this.client,
			{
				id,
				name: workflow.name,
				input: options.input,
				queue: options.queue,
				idempotencyKey: options.idempotencyKey,
				scheduledFor,
				maxAttempts: options.maxAttempts,
			},
		);

		if (created) {
			this.dispatcher.recordEnqueued(workflow.name, options.queue);
			this.dispatcher.wake();
		}

		return new WorkflowHandle<TOutput>(workflowId, this.client, () =>
			this.dispatcher?.wake(),
		);
	}

	/** Cancels a workflow by id. */
	async cancel(workflowId: string): Promise<boolean> {
		if (!this.client) return false;
		const handle = new WorkflowHandle(workflowId, this.client, () =>
			this.dispatcher?.wake(),
		);
		return handle.cancel();
	}

	/** Whether the runtime completed boot and passed `PRAGMA quick_check`. */
	get healthy(): boolean {
		return this.started && this.quickCheckOk;
	}
}

export const runtime = new KokotoRuntime();
