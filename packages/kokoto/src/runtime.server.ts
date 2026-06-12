import { EventEmitter } from 'node:events'
import {
	BootIntegrityError,
	DurableCancelledError,
	DurableTimeoutError,
	UnknownWorkflowError,
} from './errors.ts'
import { WorkflowRegistry } from './registry.ts'
import { KOKOTO_DDL } from './schema.server.ts'

// Re-export the registry helpers + errors + schema constants so server-only
// callers can stay on the `/runtime.server` subpath. Importing runtime values
// from the bare `@pickmyfruit/kokoto` entry breaks TanStack Start's SSR
// asset-manifest builder (no compiled output to register an `href` for).
export { defineQueue, defineWorkflow, WorkflowRegistry } from './registry.ts'
export {
	BootIntegrityError,
	DurableCancelledError,
	DurableTimeoutError,
	KokotoError,
	PayloadTooLargeError,
	ReplayedStepError,
	UnknownWorkflowError,
} from './errors.ts'
export { Metrics } from './telemetry.server.ts'
export {
	KOKOTO_DDL,
	KOKOTO_TABLES,
	PAYLOAD_BYTE_CAP,
	PROTOCOL_VERSION,
	createSchemaSQL,
} from './schema.server.ts'
export type {
	DefineQueueOptions,
	DefineWorkflowOptions,
	KokotoTelemetry,
	QueueDefinition,
	RuntimeConfig,
	RuntimeStartConfig,
	SqlClient,
	SqlResult,
	SqlStatement,
	SqlTransaction,
	StartWorkflowOptions,
	StepStatus,
	WorkflowContext,
	WorkflowDefinition,
	WorkflowFn,
	WorkflowHandle,
	WorkflowStatus,
} from './types.ts'
import {
	claimPending,
	decodePayload,
	encodePayload,
	extendLeases,
	reclaimExpired,
	requestCancel,
	selectStepsForWorkflow,
	selectWorkflowById,
	selectWorkflowByIdempotencyKey,
	touchExecutorHeartbeat,
	type WorkflowRow,
} from './sql.server.ts'
import { Metrics, Telemetry } from './telemetry.server.ts'
import type {
	QueueDefinition,
	RuntimeConfig,
	RuntimeStartConfig,
	SqlClient,
	StartWorkflowOptions,
	WorkflowDefinition,
	WorkflowHandle,
	WorkflowStatus,
} from './types.ts'
import { uuidv7 } from './uuidv7.ts'
import { runWorkflow } from './worker.server.ts'

const DEFAULT_POLL_MS = 250
/**
 * Default `idleMaxMs` as a multiple of `pollMs`. An idle dispatcher (nothing
 * claimed, nothing in flight) doubles its delay each tick up to this cap, so
 * it stops hammering SQLite with heartbeat/claim writes when there is no
 * work. Wake events (enqueues, worker completions) reset the cadence.
 */
const DEFAULT_IDLE_BACKOFF_FACTOR = 10
const DEFAULT_GLOBAL_CONCURRENCY = 16
/**
 * Default lease duration: how long a claimed workflow stays un-reclaimable
 * before the heartbeat tick must extend it. 30s gives a ~30× margin over
 * the typical I/O step time and outlives a missed tick or two on a slow
 * event loop, while still bounding the duplicate-execution window if the
 * dispatcher genuinely dies. Configurable via `RuntimeConfig.leaseMs`.
 */
const DEFAULT_LEASE_MS = 30_000

/**
 * In-process durable workflow runtime backed by a single SQLite database.
 *
 * Lifecycle:
 *   1. Construct via {@link createRuntime}.
 *   2. Call {@link DurableRuntime.start} once at boot, after migrations.
 *   3. Enqueue workflows with {@link DurableRuntime.startWorkflow}.
 *   4. Call {@link DurableRuntime.stop} on SIGTERM/SIGINT.
 */
export class DurableRuntime {
	private readonly client: SqlClient
	private readonly telemetry: Telemetry
	private readonly registry = new WorkflowRegistry()
	private readonly pollMs: number
	private readonly idleMaxMs: number
	private readonly leaseMs: number
	private readonly globalConcurrency: number
	private readonly executorId: string
	private readonly inFlight = new Set<string>()
	private readonly perQueueInFlight = new Map<string, number>()
	private readonly wake = new EventEmitter()
	private dispatcherActive = false
	private stopping = false
	private startedAt: number | null = null
	private currentDispatch: Promise<unknown> = Promise.resolve()
	/** Current dispatcher delay; grows toward idleMaxMs while idle. */
	private idleDelayMs: number

	constructor(config: RuntimeConfig) {
		this.client = config.client
		this.telemetry = new Telemetry(config.telemetry)
		this.pollMs = Math.max(10, config.pollMs ?? DEFAULT_POLL_MS)
		this.idleMaxMs = Math.max(
			this.pollMs,
			config.idleMaxMs ?? this.pollMs * DEFAULT_IDLE_BACKOFF_FACTOR
		)
		this.idleDelayMs = this.pollMs
		// leaseMs of 0 is legal (and used by the lease-expiry test): the row's
		// expiry is set to `now`, which is already in the past by the time
		// reclaim reads it, so the row is immediately reclaimable.
		this.leaseMs = Math.max(0, config.leaseMs ?? DEFAULT_LEASE_MS)
		this.globalConcurrency = Math.max(
			1,
			config.globalConcurrency ?? DEFAULT_GLOBAL_CONCURRENCY
		)
		this.executorId = config.executorId ?? uuidv7()
	}

	/** Unique id for this boot — recorded on every claimed row's `executor_id`. */
	get id(): string {
		return this.executorId
	}

	/**
	 * Apply the kokoto DDL to the connected database. Idempotent — safe to call
	 * in tests against a fresh in-memory database. Production apps should run
	 * the SQL through their migration journal instead and skip this helper.
	 */
	async createSchema(): Promise<void> {
		for (const stmt of KOKOTO_DDL) {
			await this.client.execute(stmt)
		}
	}

	/**
	 * Register workflows + queues, run recovery, gate-check integrity, then
	 * kick off the dispatcher loop. Returns once boot work is complete; the
	 * dispatcher keeps running until {@link stop} is invoked.
	 */
	async start(config: RuntimeStartConfig): Promise<void> {
		if (this.startedAt != null) {
			throw new Error('DurableRuntime.start() called twice')
		}

		for (const workflow of config.workflows) {
			this.registry.registerWorkflow(workflow)
		}
		for (const queue of config.queues ?? []) {
			this.registry.registerQueue(queue)
			this.perQueueInFlight.set(queue.name, 0)
		}

		await this.runBootIntegrityCheck()

		const now = Date.now()
		await this.client.execute({
			sql: `INSERT INTO _dc_executor (id, started_at, heartbeat_at) VALUES (?, ?, ?)`,
			args: [this.executorId, now, now],
		})

		const reclaimed = await reclaimExpired(this.client, now)
		if (reclaimed > 0) {
			this.telemetry.count(Metrics.workflowRecovered, {}, reclaimed)
			this.telemetry.info(
				{ executorId: this.executorId, reclaimed },
				'kokoto.runtime.recovered'
			)
		}

		this.startedAt = now
		this.dispatcherActive = true
		this.scheduleDispatchSoon()
		this.telemetry.info(
			{ executorId: this.executorId, pollMs: this.pollMs },
			'kokoto.runtime.started'
		)
	}

	/**
	 * Stop the dispatcher and wait for any in-flight workflow worker to finish
	 * its current step boundary. Safe to call multiple times.
	 */
	async stop(): Promise<void> {
		if (!this.dispatcherActive) return
		this.stopping = true
		this.dispatcherActive = false
		this.wake.emit('wake')
		await this.currentDispatch
		this.telemetry.info({ executorId: this.executorId }, 'kokoto.runtime.stopped')
	}

	/**
	 * Enqueue a workflow. Returns a {@link WorkflowHandle} that can wait for
	 * its terminal status. If `idempotencyKey` collides with an existing row,
	 * the existing row's handle is returned and the new input is ignored.
	 */
	async startWorkflow<Input, Output>(
		workflow: WorkflowDefinition<Input, Output>,
		input: Input,
		options: StartWorkflowOptions = {}
	): Promise<WorkflowHandle<Output>> {
		const def = this.registry.getWorkflow(workflow.name)
		if (!def) {
			throw new UnknownWorkflowError(workflow.name)
		}

		const id = options.id ?? uuidv7()
		const queue = options.queue ?? def.defaultQueue ?? null
		const maxAttempts = options.maxAttempts ?? def.defaultMaxAttempts
		const now = Date.now()
		const scheduledFor = options.runAt ?? now
		const encodedInput = encodePayload(input)

		await this.client.execute({
			sql: `INSERT INTO _dc_workflow
					(id, name, status, queue, input, attempts, max_attempts,
					 scheduled_for, created_at, idempotency_key, protocol_version)
				VALUES (?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?, 1)
				ON CONFLICT(idempotency_key) DO NOTHING`,
			args: [
				id,
				def.name,
				queue,
				encodedInput,
				maxAttempts,
				scheduledFor,
				now,
				options.idempotencyKey ?? null,
			],
		})

		let effectiveId = id
		if (options.idempotencyKey) {
			const existing = await selectWorkflowByIdempotencyKey(
				this.client,
				options.idempotencyKey
			)
			if (existing) effectiveId = existing.id
		}

		this.telemetry.count(Metrics.workflowEnqueued, {
			'workflow.name': def.name,
			queue: queue ?? 'none',
		})

		if (this.dispatcherActive) this.wake.emit('wake')

		return this.createHandle<Output>(effectiveId, def.name)
	}

	/** Synchronous fast-path cancel. See {@link requestCancel}. */
	async cancel(workflowId: string): Promise<void> {
		await requestCancel(this.client, workflowId, Date.now())
		this.wake.emit('wake')
	}

	/** Strongly-typed handle factory shared by `startWorkflow` and `getHandle`. */
	private createHandle<Output>(
		id: string,
		name: string
	): WorkflowHandle<Output> {
		const client = this.client
		const wake = this.wake

		return {
			id,
			name,
			async status(): Promise<WorkflowStatus> {
				const row = await selectWorkflowById(client, id)
				if (!row) throw new Error(`Workflow ${id} not found`)
				return row.status
			},
			async cancel(): Promise<void> {
				await requestCancel(client, id, Date.now())
				wake.emit('wake')
			},
			async result(opts = {}): Promise<Output> {
				const pollMs = Math.max(25, opts.pollMs ?? 100)
				const timeoutMs = opts.timeoutMs
				const deadline =
					timeoutMs == null ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs

				for (;;) {
					const row = await selectWorkflowById(client, id)
					if (!row) throw new Error(`Workflow ${id} not found`)
					if (row.status === 'success') {
						return decodePayload<Output>(row.output) as Output
					}
					if (row.status === 'error') {
						const parsed =
							decodePayload<{ name?: string; message?: string }>(row.error) ?? {}
						const err = new Error(parsed.message ?? 'Workflow failed')
						if (parsed.name) err.name = parsed.name
						throw err
					}
					if (row.status === 'cancelled') {
						throw new DurableCancelledError(id)
					}
					if (Date.now() >= deadline) {
						throw new DurableTimeoutError(id, timeoutMs!)
					}
					await new Promise<void>((resolve) => {
						const timer = setTimeout(() => {
							wake.off('wake', wakeHandler)
							resolve()
						}, pollMs)
						const wakeHandler = () => {
							clearTimeout(timer)
							resolve()
						}
						wake.once('wake', wakeHandler)
					})
				}
			},
		}
	}

	/**
	 * Acquire the latest stored row for a workflow id, including its steps. Used
	 * by tests and admin tooling, not part of the day-to-day API.
	 */
	async inspect(workflowId: string) {
		const [row, steps] = await Promise.all([
			selectWorkflowById(this.client, workflowId),
			selectStepsForWorkflow(this.client, workflowId),
		])
		return { row, steps }
	}

	/** Re-acquire a handle for a previously-enqueued workflow id. */
	async getHandle<Output = unknown>(
		workflowId: string
	): Promise<WorkflowHandle<Output>> {
		const row = await selectWorkflowById(this.client, workflowId)
		if (!row) throw new Error(`Workflow ${workflowId} not found`)
		return this.createHandle<Output>(row.id, row.name)
	}

	/**
	 * `PRAGMA quick_check` boot gate. If the database reports anything other
	 * than `'ok'`, the dispatcher stays off and {@link BootIntegrityError} is
	 * thrown so the host can fail closed.
	 */
	private async runBootIntegrityCheck(): Promise<void> {
		const result = await this.client.execute('PRAGMA quick_check')
		const row = result.rows[0]
		if (!row) {
			this.telemetry.count(Metrics.bootQuickCheckFailed, {})
			throw new BootIntegrityError(
				'PRAGMA quick_check returned no rows; refusing to start dispatcher'
			)
		}
		const status = String(Object.values(row)[0])
		if (status.trim().toLowerCase() !== 'ok') {
			this.telemetry.count(Metrics.bootQuickCheckFailed, {})
			throw new BootIntegrityError(
				`PRAGMA quick_check reported "${status}"; refusing to start dispatcher`
			)
		}
	}

	/**
	 * Schedule the next dispatcher tick. Uses `setTimeout` so each tick is
	 * decoupled from the previous one — a slow tick doesn't stall wake events.
	 *
	 * While the runtime is idle, the delay doubles each tick from `pollMs` up
	 * to `idleMaxMs` so an idle process doesn't keep writing to SQLite; any
	 * wake event resets the cadence to `pollMs` and dispatches immediately.
	 */
	private scheduleDispatchSoon(): void {
		if (!this.dispatcherActive) return
		// Capture wake events that fire while the tick itself is running —
		// otherwise an enqueue landing mid-tick has no listener and would wait
		// out the full (possibly backed-off) delay before being claimed.
		let wokeDuringTick = false
		const wakeDuringTick = (): void => {
			wokeDuringTick = true
		}
		this.wake.once('wake', wakeDuringTick)
		const tickPromise = this.dispatchTick()
		this.currentDispatch = tickPromise
		tickPromise
			.then(
				(claimed) => {
					const idle = claimed === 0 && this.inFlight.size === 0
					this.idleDelayMs = idle
						? Math.min(this.idleDelayMs * 2, this.idleMaxMs)
						: this.pollMs
				},
				(err) => {
					this.idleDelayMs = this.pollMs
					this.telemetry.captureException(err)
				}
			)
			.finally(() => {
				this.wake.off('wake', wakeDuringTick)
				if (!this.dispatcherActive) return
				if (wokeDuringTick) {
					this.idleDelayMs = this.pollMs
					this.scheduleDispatchSoon()
					return
				}
				const timer: NodeJS.Timeout = setTimeout(() => {
					this.wake.off('wake', wakeHandler)
					this.scheduleDispatchSoon()
				}, this.idleDelayMs)
				const wakeHandler = (): void => {
					clearTimeout(timer)
					this.idleDelayMs = this.pollMs
					this.scheduleDispatchSoon()
				}
				this.wake.once('wake', wakeHandler)
			})
	}

	private capacityRemaining(): number {
		return Math.max(0, this.globalConcurrency - this.inFlight.size)
	}

	private capacityForQueue(queue: QueueDefinition | null): number {
		if (!queue) return this.capacityRemaining()
		const used = this.perQueueInFlight.get(queue.name) ?? 0
		return Math.max(
			0,
			Math.min(this.capacityRemaining(), queue.concurrency - used)
		)
	}

	/** Returns the number of workflows claimed, so the scheduler can detect idleness. */
	private async dispatchTick(): Promise<number> {
		if (!this.dispatcherActive || this.stopping) return 0
		const now = Date.now()

		// Heartbeat first: extend the lease on every running row this
		// executor owns BEFORE we look for new work. If this tick is the one
		// that's been delayed (event loop hiccup, GC pause), the heartbeat
		// re-anchors our leases against a fresh `now` and prevents an
		// in-flight workflow from being reclaimed by a peer.
		if (this.inFlight.size > 0) {
			await extendLeases(this.client, this.executorId, now + this.leaseMs)
		}
		await touchExecutorHeartbeat(this.client, this.executorId, now)

		const allQueues = this.registry.listQueues()
		let totalClaimed = 0

		for (const queue of allQueues) {
			const capacity = this.capacityForQueue(queue)
			if (capacity === 0) continue
			const claimed = await claimPending(
				this.client,
				this.executorId,
				now,
				this.leaseMs,
				capacity,
				queue.name
			)
			totalClaimed += claimed.length
			for (const row of claimed) {
				this.launchWorker(row, queue.name)
			}
		}

		const generalCapacity = this.capacityForQueue(null)
		if (generalCapacity > 0) {
			const claimed = await claimPending(
				this.client,
				this.executorId,
				now,
				this.leaseMs,
				generalCapacity,
				null
			)
			totalClaimed += claimed.length
			for (const row of claimed) {
				this.launchWorker(row, null)
			}
		}

		if (totalClaimed > 0) {
			this.telemetry.count(Metrics.dispatchClaimed, {}, totalClaimed)
		}
		return totalClaimed
	}

	private launchWorker(row: WorkflowRow, queueName: string | null): void {
		this.inFlight.add(row.id)
		if (queueName) {
			this.perQueueInFlight.set(
				queueName,
				(this.perQueueInFlight.get(queueName) ?? 0) + 1
			)
		}
		this.telemetry.count(Metrics.workflowDispatched, {
			'workflow.name': row.name,
			queue: queueName ?? 'none',
		})

		void (async () => {
			try {
				await runWorkflow(this.client, this.registry, this.telemetry, row)
			} catch (err) {
				this.telemetry.captureException(err, { workflow: row.name })
			} finally {
				this.inFlight.delete(row.id)
				if (queueName) {
					this.perQueueInFlight.set(
						queueName,
						Math.max(0, (this.perQueueInFlight.get(queueName) ?? 1) - 1)
					)
				}
				this.wake.emit('wake')
			}
		})()
	}
}

/** Factory function — `new DurableRuntime(config)` is also fine. */
export function createRuntime(config: RuntimeConfig): DurableRuntime {
	return new DurableRuntime(config)
}
