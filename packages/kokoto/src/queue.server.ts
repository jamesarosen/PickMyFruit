export type QueueDefinition = {
	name: string;
	concurrency: number;
};

const queues = new Map<string, QueueDefinition>();

/** Declares a named queue with a concurrency cap. */
export function defineQueue(
	name: string,
	options: { concurrency: number },
): QueueDefinition {
	const queue: QueueDefinition = { name, concurrency: options.concurrency };
	queues.set(name, queue);
	return queue;
}

/** Returns a registered queue definition. */
export function getQueue(name: string): QueueDefinition | undefined {
	return queues.get(name);
}

/** Clears queue registry (tests only). */
export function clearQueues(): void {
	queues.clear();
}

/** Lists all registered queues. */
export function listQueues(): QueueDefinition[] {
	return [...queues.values()];
}
