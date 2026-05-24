import type {
	DefineQueueOptions,
	DefineWorkflowOptions,
	QueueDefinition,
	WorkflowDefinition,
	WorkflowFn,
} from './types.ts'

/**
 * Define a durable workflow. The returned definition is immutable and registers
 * its `name` so the runtime can dispatch it when claimed rows come up. Names
 * must be globally unique within a process.
 */
export function defineWorkflow<Input = unknown, Output = unknown>(
	name: string,
	fn: WorkflowFn<Input, Output>,
	options: DefineWorkflowOptions = {}
): WorkflowDefinition<Input, Output> {
	if (!name || typeof name !== 'string') {
		throw new TypeError('defineWorkflow: name must be a non-empty string')
	}
	if (typeof fn !== 'function') {
		throw new TypeError('defineWorkflow: fn must be a function')
	}
	return Object.freeze({
		name,
		fn,
		defaultQueue: options.queue,
		defaultMaxAttempts: options.maxAttempts ?? 3,
	}) satisfies WorkflowDefinition<Input, Output>
}

/**
 * Define a named queue with bounded concurrency. Queues throttle parallelism;
 * they do not schedule time-delayed work.
 */
export function defineQueue(
	name: string,
	options: DefineQueueOptions
): QueueDefinition {
	if (!name || typeof name !== 'string') {
		throw new TypeError('defineQueue: name must be a non-empty string')
	}
	if (
		!Number.isInteger(options.concurrency) ||
		options.concurrency < 1 ||
		options.concurrency > 1024
	) {
		throw new RangeError(
			'defineQueue: concurrency must be an integer in [1, 1024]'
		)
	}
	return Object.freeze({ name, concurrency: options.concurrency })
}

/**
 * In-memory registry used by a runtime instance. Workflows and queues live
 * here so the dispatcher can resolve a name -> handler in O(1).
 */
export class WorkflowRegistry {
	private readonly workflows = new Map<string, WorkflowDefinition<any, any>>()
	private readonly queues = new Map<string, QueueDefinition>()

	registerWorkflow(def: WorkflowDefinition<any, any>): void {
		if (this.workflows.has(def.name)) {
			throw new Error(
				`Workflow "${def.name}" is already registered on this runtime`
			)
		}
		this.workflows.set(def.name, def)
	}

	registerQueue(def: QueueDefinition): void {
		if (this.queues.has(def.name)) {
			throw new Error(`Queue "${def.name}" is already registered on this runtime`)
		}
		this.queues.set(def.name, def)
	}

	getWorkflow(name: string): WorkflowDefinition<any, any> | undefined {
		return this.workflows.get(name)
	}

	getQueue(name: string): QueueDefinition | undefined {
		return this.queues.get(name)
	}

	listWorkflows(): WorkflowDefinition<any, any>[] {
		return [...this.workflows.values()]
	}

	listQueues(): QueueDefinition[] {
		return [...this.queues.values()]
	}
}
