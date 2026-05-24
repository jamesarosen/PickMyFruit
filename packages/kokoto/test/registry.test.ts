import { describe, expect, it } from 'vitest'
import {
	defineQueue,
	defineWorkflow,
	WorkflowRegistry,
} from '../src/registry.ts'

describe('defineWorkflow', () => {
	it('returns a frozen definition with defaults', () => {
		const def = defineWorkflow('greet', async (_ctx, name: string) => name)
		expect(def.name).toBe('greet')
		expect(def.defaultMaxAttempts).toBe(3)
		expect(def.defaultQueue).toBeUndefined()
		expect(Object.isFrozen(def)).toBe(true)
	})

	it('respects options', () => {
		const def = defineWorkflow(
			'with-opts',
			async (_ctx, input: number) => input + 1,
			{ queue: 'media', maxAttempts: 1 }
		)
		expect(def.defaultQueue).toBe('media')
		expect(def.defaultMaxAttempts).toBe(1)
	})

	it('rejects empty names', () => {
		expect(() => defineWorkflow('', async () => undefined)).toThrow(TypeError)
	})

	it('rejects non-function bodies', () => {
		expect(() => defineWorkflow('x', undefined as never)).toThrow(TypeError)
	})
})

describe('defineQueue', () => {
	it('returns a frozen queue with concurrency', () => {
		const queue = defineQueue('media', { concurrency: 2 })
		expect(queue).toEqual({ name: 'media', concurrency: 2 })
		expect(Object.isFrozen(queue)).toBe(true)
	})

	it('rejects bad concurrency', () => {
		expect(() => defineQueue('q', { concurrency: 0 })).toThrow(RangeError)
		expect(() => defineQueue('q', { concurrency: -1 })).toThrow(RangeError)
		expect(() => defineQueue('q', { concurrency: 1.5 })).toThrow(RangeError)
		expect(() => defineQueue('q', { concurrency: 10_000 })).toThrow(RangeError)
	})
})

describe('WorkflowRegistry', () => {
	it('prevents duplicate registration', () => {
		const registry = new WorkflowRegistry()
		registry.registerWorkflow(defineWorkflow('w', async () => undefined))
		expect(() =>
			registry.registerWorkflow(defineWorkflow('w', async () => undefined))
		).toThrow(/already registered/)
	})

	it('exposes registered workflows and queues', () => {
		const registry = new WorkflowRegistry()
		const w = defineWorkflow('a', async () => undefined)
		const q = defineQueue('media', { concurrency: 1 })
		registry.registerWorkflow(w)
		registry.registerQueue(q)
		expect(registry.getWorkflow('a')).toBe(w)
		expect(registry.getQueue('media')).toBe(q)
		expect(registry.listWorkflows()).toEqual([w])
		expect(registry.listQueues()).toEqual([q])
	})
})
