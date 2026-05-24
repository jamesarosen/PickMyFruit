import type { Client } from "@libsql/client";
import { executeWorkflow } from "./execute.server.js";
import { getQueue, listQueues } from "./queue.server.js";
import * as store from "./store.server.js";
import {
	recordDispatchClaimed,
	recordWorkflowDispatched,
	recordWorkflowEnqueued,
	recordWorkflowRecovered,
} from "./telemetry.server.js";
import {
	DEFAULT_GLOBAL_CONCURRENCY,
	EXECUTOR_HEARTBEAT_MS,
	EXECUTOR_STALE_HEARTBEAT_MULTIPLIER,
} from "./types.server.js";

type DispatcherOptions = {
	client: Client;
	executorId: string;
	globalConcurrency?: number;
	onIdle?: () => void;
};

/** In-process workflow dispatcher with queue concurrency ledgers. */
export class Dispatcher {
	private readonly globalConcurrency: number;
	private runningGlobal = 0;
	private readonly runningByQueue = new Map<string, number>();
	private stopped = false;
	private ticking = false;
	private wakeResolvers: Array<() => void> = [];
	private heartbeatTimer: ReturnType<typeof setInterval> | undefined;

	constructor(private readonly options: DispatcherOptions) {
		this.globalConcurrency =
			options.globalConcurrency ?? DEFAULT_GLOBAL_CONCURRENCY;
	}

	wake(): void {
		for (const resolve of this.wakeResolvers) resolve();
		this.wakeResolvers = [];
		void this.tick();
	}

	stop(): void {
		this.stopped = true;
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
	}

	async drain(): Promise<void> {
		while (this.ticking) {
			await new Promise((r) => setTimeout(r, 5));
		}
	}

	startHeartbeat(): void {
		this.heartbeatTimer = setInterval(() => {
			void store
				.touchExecutorHeartbeat(this.options.client, this.options.executorId)
				.catch(() => {});
			void this.reclaimStale().catch(() => {});
		}, EXECUTOR_HEARTBEAT_MS);
	}

	private async reclaimStale(): Promise<void> {
		const staleBefore =
			Date.now() - EXECUTOR_HEARTBEAT_MS * EXECUTOR_STALE_HEARTBEAT_MULTIPLIER;
		const names = await store.recoverStaleWorkflows(this.options.client, {
			executorId: this.options.executorId,
			staleBeforeMs: staleBefore,
		});
		for (const name of names) {
			recordWorkflowRecovered(name);
		}
		if (names.length > 0) this.wake();
	}

	private availableGlobalSlots(): number {
		return Math.max(0, this.globalConcurrency - this.runningGlobal);
	}

	private trackStart(queueName: string | null): void {
		this.runningGlobal += 1;
		if (queueName) {
			this.runningByQueue.set(
				queueName,
				(this.runningByQueue.get(queueName) ?? 0) + 1,
			);
		}
	}

	private trackEnd(queueName: string | null): void {
		this.runningGlobal = Math.max(0, this.runningGlobal - 1);
		if (queueName) {
			const next = (this.runningByQueue.get(queueName) ?? 1) - 1;
			if (next <= 0) this.runningByQueue.delete(queueName);
			else this.runningByQueue.set(queueName, next);
		}
	}

	async tick(): Promise<void> {
		if (this.stopped || this.ticking) return;
		this.ticking = true;
		try {
			const globalSlots = this.availableGlobalSlots();
			if (globalSlots <= 0) return;

			const now = Date.now();
			const candidates = await store.listPendingWorkflowIds(
				this.options.client,
				{ now, limit: globalSlots * 4 },
			);

			const toClaim: string[] = [];
			const queueScratch = new Map(this.runningByQueue);

			for (const id of candidates) {
				if (toClaim.length >= globalSlots) break;
				const row = await store.getWorkflow(this.options.client, id);
				if (!row || row.status !== "pending") continue;
				const queueName = row.queue;
				if (queueName) {
					const def = getQueue(queueName);
					const cap = def?.concurrency ?? Number.POSITIVE_INFINITY;
					const running = queueScratch.get(queueName) ?? 0;
					if (running >= cap) continue;
					queueScratch.set(queueName, running + 1);
				}
				toClaim.push(id);
			}

			if (toClaim.length === 0) return;

			const claimed = await store.claimWorkflowIds(this.options.client, {
				executorId: this.options.executorId,
				ids: toClaim,
			});

			recordDispatchClaimed(undefined, claimed.length);

			for (const row of claimed) {
				this.trackStart(row.queue);
				recordWorkflowDispatched(row.name, row.queue ?? undefined);
				void this.runOne(row);
			}
		} finally {
			this.ticking = false;
			this.options.onIdle?.();
		}
	}

	private async runOne(
		row: Awaited<ReturnType<typeof store.claimWorkflowIds>>[number],
	): Promise<void> {
		const isReplay = row.attempts > 1;
		try {
			await executeWorkflow(this.options.client, row, { isReplay });
		} finally {
			this.trackEnd(row.queue);
			if (!this.stopped) void this.tick();
		}
	}

	recordEnqueued(workflowName: string, queue?: string): void {
		recordWorkflowEnqueued(workflowName, queue);
	}

	waitForWake(signal?: AbortSignal): Promise<void> {
		return new Promise((resolve) => {
			if (signal?.aborted) {
				resolve();
				return;
			}
			this.wakeResolvers.push(resolve);
			signal?.addEventListener("abort", () => resolve(), { once: true });
		});
	}
}

/** Returns configured queue names (for diagnostics). */
export function configuredQueueNames(): string[] {
	return listQueues().map((q) => q.name);
}
