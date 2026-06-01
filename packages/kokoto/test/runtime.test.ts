import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Client } from '@libsql/client/node'
import { defineQueue, defineWorkflow } from '../src/registry.ts'
import { DurableCancelledError, DurableTimeoutError } from '../src/errors.ts'
import { Metrics } from '../src/telemetry.server.ts'
import { makeRecorder, newClient, newRuntime, sleep } from './helpers.ts'
import type { DurableRuntime } from '../src/runtime.server.ts'

describe('DurableRuntime — happy path', () => {
	let client: Client
	let runtime: DurableRuntime

	beforeEach(async () => {
		client = await newClient()
		runtime = await newRuntime({ client })
	})

	afterEach(async () => {
		await runtime.stop()
		client.close()
	})

	it('runs a single-step workflow to success', async () => {
		const echo = defineWorkflow('echo', async (_ctx, input: string) => {
			return input.toUpperCase()
		})
		await runtime.start({ workflows: [echo] })

		const handle = await runtime.startWorkflow(echo, 'hello')
		const result = await handle.result({ timeoutMs: 5_000 })

		expect(result).toBe('HELLO')
		expect(await handle.status()).toBe('success')
	})

	it('stores and replays step outputs', async () => {
		let bodyCalls = 0
		let stepCalls = 0
		const flaky = defineWorkflow('flaky', async (ctx) => {
			bodyCalls++
			const first = await ctx.step('first', () => {
				stepCalls++
				return 1
			})
			if (bodyCalls === 1) {
				throw new Error('crash after first step')
			}
			const second = await ctx.step('second', () => {
				stepCalls++
				return first + 10
			})
			return second
		})
		await runtime.start({ workflows: [flaky] })

		const handle = await runtime.startWorkflow(flaky, undefined, {
			maxAttempts: 3,
		})
		const result = await handle.result({ timeoutMs: 5_000 })

		expect(result).toBe(11)
		expect(bodyCalls).toBeGreaterThanOrEqual(2)
		// step "first" must run exactly once even across retries
		expect(stepCalls).toBe(2)

		const inspected = await runtime.inspect(handle.id)
		expect(inspected.steps.map((s) => s.step_id).sort()).toEqual([
			'first',
			'second',
		])
	})

	it('respects idempotency_key collisions', async () => {
		const noop = defineWorkflow('noop', async () => 'done')
		await runtime.start({ workflows: [noop] })

		const h1 = await runtime.startWorkflow(noop, undefined, {
			idempotencyKey: 'same',
		})
		const h2 = await runtime.startWorkflow(noop, undefined, {
			idempotencyKey: 'same',
		})

		expect(h1.id).toBe(h2.id)
		await h1.result({ timeoutMs: 5_000 })
	})
})

describe('DurableRuntime — telemetry', () => {
	it('emits enqueued/dispatched/finished/step lifecycle counters', async () => {
		const client = await newClient()
		const recorder = makeRecorder()
		const runtime = await newRuntime({ client, telemetry: recorder.telemetry })

		const w = defineWorkflow('telemetry-target', async (ctx) => {
			await ctx.step('s1', () => 'a')
			await ctx.step('s2', () => 'b')
		})
		await runtime.start({ workflows: [w] })
		const handle = await runtime.startWorkflow(w, undefined)
		await handle.result({ timeoutMs: 5_000 })
		await runtime.stop()
		client.close()

		const names = recorder.metrics.map((m) => m.name)
		expect(names).toContain(Metrics.workflowEnqueued)
		expect(names).toContain(Metrics.workflowDispatched)
		expect(names).toContain(Metrics.workflowFinished)
		expect(names).toContain(Metrics.stepStarted)
		expect(names).toContain(Metrics.stepFinished)
		expect(names).toContain(Metrics.stepDurationMs)

		const finished = recorder.metrics.find(
			(m) => m.name === Metrics.workflowFinished
		)
		expect(finished?.attrs.status).toBe('success')
	})
})

describe('DurableRuntime — error paths', () => {
	let client: Client
	let runtime: DurableRuntime

	beforeEach(async () => {
		client = await newClient()
		runtime = await newRuntime({ client })
	})

	afterEach(async () => {
		await runtime.stop()
		client.close()
	})

	it('finalizes the workflow as error after max_attempts is exhausted', async () => {
		const fail = defineWorkflow('always-fail', async () => {
			throw new Error('nope')
		})
		await runtime.start({ workflows: [fail] })
		const handle = await runtime.startWorkflow(fail, undefined, {
			maxAttempts: 2,
		})
		await expect(handle.result({ timeoutMs: 5_000, pollMs: 25 })).rejects.toThrow(
			/nope/
		)
		expect(await handle.status()).toBe('error')
	})

	it('result() times out cleanly', async () => {
		const slow = defineWorkflow('slow', async () => {
			await sleep(5_000)
		})
		await runtime.start({ workflows: [slow] })
		const handle = await runtime.startWorkflow(slow, undefined)
		await expect(handle.result({ timeoutMs: 100 })).rejects.toBeInstanceOf(
			DurableTimeoutError
		)
	})

	// Regression: a step that throws used to write an `error` row to `_dc_step`,
	// poisoning every subsequent retry with `ReplayedStepError`. Only success
	// should be durable — failures replay from scratch.
	it('re-runs a step that failed once on the next workflow attempt', async () => {
		let calls = 0
		const flake = defineWorkflow('flake', async (ctx) => {
			return ctx.step('sometimes', async () => {
				calls++
				if (calls === 1) throw new Error('first try, on purpose')
				return 'recovered'
			})
		})
		await runtime.start({ workflows: [flake] })

		const handle = await runtime.startWorkflow(flake, undefined, {
			maxAttempts: 3,
		})
		const result = await handle.result({ timeoutMs: 10_000, pollMs: 25 })

		expect(result).toBe('recovered')
		expect(calls).toBe(2)
		expect(await handle.status()).toBe('success')
		const stepRows = await client.execute(
			`SELECT status, COUNT(*) AS n FROM _dc_step WHERE workflow_id = '${handle.id}' GROUP BY status`
		)
		expect(stepRows.rows).toEqual([{ status: 'success', n: 1 }])
	})
})

describe('DurableRuntime — cancellation', () => {
	it('cancels a pending workflow immediately', async () => {
		const client = await newClient()
		const runtime = await newRuntime({ client, pollMs: 5_000 })
		const noop = defineWorkflow('noop', async () => undefined)
		await runtime.start({ workflows: [noop] })
		const handle = await runtime.startWorkflow(noop, undefined, {
			runAt: Date.now() + 60_000,
		})
		await handle.cancel()
		await expect(handle.result({ timeoutMs: 1_000 })).rejects.toBeInstanceOf(
			DurableCancelledError
		)
		await runtime.stop()
		client.close()
	})

	it('cancels a running workflow at the next step boundary', async () => {
		const client = await newClient()
		const runtime = await newRuntime({ client })

		// Park the first step with an external gate so the test can issue cancel()
		// while the worker is mid-step. Once released, the worker reaches the
		// next ctx.step() boundary and observes the cancellation flag.
		let releaseFirst!: () => void
		const firstParked = new Promise<void>((res) => {
			releaseFirst = res
		})

		const longRunning = defineWorkflow('long', async (ctx) => {
			await ctx.step('first', async () => {
				await firstParked
				return 1
			})
			await ctx.step('second', async () => 2)
		})
		await runtime.start({ workflows: [longRunning] })
		const handle = await runtime.startWorkflow(longRunning, undefined)

		// Spin until dispatcher claims the row.
		for (let i = 0; i < 200; i++) {
			if ((await handle.status()) === 'running') break
			await sleep(10)
		}
		expect(await handle.status()).toBe('running')

		await handle.cancel()
		releaseFirst()

		await expect(handle.result({ timeoutMs: 5_000 })).rejects.toBeInstanceOf(
			DurableCancelledError
		)
		await runtime.stop()
		client.close()
	})
})

describe('DurableRuntime — queue concurrency', () => {
	it('honors per-queue concurrency limits', async () => {
		const client = await newClient()
		const runtime = await newRuntime({ client, pollMs: 10 })
		const queue = defineQueue('serial', { concurrency: 1 })

		let inFlight = 0
		let maxObserved = 0
		const w = defineWorkflow('serial-w', async (ctx) => {
			await ctx.step('work', async () => {
				inFlight++
				maxObserved = Math.max(maxObserved, inFlight)
				await sleep(40)
				inFlight--
			})
		})
		await runtime.start({ workflows: [w], queues: [queue] })

		const handles = await Promise.all([
			runtime.startWorkflow(w, undefined, { queue: 'serial' }),
			runtime.startWorkflow(w, undefined, { queue: 'serial' }),
			runtime.startWorkflow(w, undefined, { queue: 'serial' }),
		])
		await Promise.all(handles.map((h) => h.result({ timeoutMs: 5_000 })))

		expect(maxObserved).toBe(1)
		await runtime.stop()
		client.close()
	})
})

describe('DurableRuntime — crash recovery', () => {
	it('reclaims abandoned running rows on next boot', async () => {
		const client = await newClient()
		await client.execute('PRAGMA journal_mode = MEMORY')

		const r1 = await newRuntime({ client, pollMs: 10_000 })
		const w = defineWorkflow('recover', async () => 'ok')
		await r1.start({ workflows: [w] })
		const handle = await r1.startWorkflow(w, undefined)

		// Manually force the row into "running" with a stale executor id to
		// simulate a crash mid-flight.
		await client.execute({
			sql: `UPDATE _dc_workflow SET status='running', executor_id='dead-exec' WHERE id = ?`,
			args: [handle.id],
		})
		await r1.stop()

		const r2 = await newRuntime({ client, pollMs: 10 })
		await r2.start({ workflows: [w] })
		const h2 = await r2.getHandle<string>(handle.id)
		const result = await h2.result({ timeoutMs: 5_000 })
		expect(result).toBe('ok')

		await r2.stop()
		client.close()
	})
})

describe('DurableRuntime — ctx.txStep (same-DB atomicity)', () => {
	let client: Client
	let runtime: DurableRuntime

	beforeEach(async () => {
		client = await newClient()
		runtime = await newRuntime({ client })
		await client.execute(
			`CREATE TABLE app_writes (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT NOT NULL)`
		)
	})

	afterEach(async () => {
		await runtime.stop()
		client.close()
	})

	it('commits the user write and the _dc_step row in one transaction', async () => {
		const insertWf = defineWorkflow('tx-insert', async (ctx) => {
			return ctx.txStep('appendRow', async (tx) => {
				const result = await tx.execute({
					sql: `INSERT INTO app_writes (note) VALUES (?) RETURNING id`,
					args: ['hello'],
				})
				const id = result.rows[0]?.id as number
				return { id }
			})
		})
		await runtime.start({ workflows: [insertWf] })
		const handle = await runtime.startWorkflow(insertWf, undefined)
		const { id } = await handle.result({ timeoutMs: 5_000, pollMs: 25 })

		const appRows = await client.execute('SELECT note FROM app_writes')
		expect(appRows.rows).toEqual([{ note: 'hello' }])
		const stepRows = await client.execute(
			`SELECT name, status FROM _dc_step WHERE workflow_id = '${handle.id}'`
		)
		expect(stepRows.rows).toEqual([{ name: 'appendRow', status: 'success' }])
		expect(typeof id).toBe('number')
	})

	it('rolls back the user write when the step throws (no orphan row)', async () => {
		const flakyWf = defineWorkflow('tx-rollback', async (ctx) => {
			return ctx.txStep('writeThenFail', async (tx) => {
				await tx.execute({
					sql: `INSERT INTO app_writes (note) VALUES (?)`,
					args: ['transient'],
				})
				throw new Error('mid-step boom')
			})
		})
		await runtime.start({ workflows: [flakyWf] })
		const handle = await runtime.startWorkflow(flakyWf, undefined, {
			maxAttempts: 1,
		})
		await expect(handle.result({ timeoutMs: 5_000, pollMs: 25 })).rejects.toThrow(
			/mid-step boom/
		)

		const appRows = await client.execute('SELECT COUNT(*) AS n FROM app_writes')
		expect(appRows.rows[0]?.n).toBe(0)
		const stepRows = await client.execute(
			`SELECT COUNT(*) AS n FROM _dc_step WHERE workflow_id = '${handle.id}'`
		)
		expect(stepRows.rows[0]?.n).toBe(0)
	})

	it('re-runs txStep on the next attempt after a transient failure', async () => {
		let calls = 0
		const recoverWf = defineWorkflow('tx-recover', async (ctx) => {
			return ctx.txStep('write', async (tx) => {
				calls++
				if (calls === 1) throw new Error('transient db error')
				await tx.execute({
					sql: `INSERT INTO app_writes (note) VALUES (?)`,
					args: ['second-try'],
				})
				return { ok: true }
			})
		})
		await runtime.start({ workflows: [recoverWf] })
		const handle = await runtime.startWorkflow(recoverWf, undefined, {
			maxAttempts: 3,
		})
		const result = await handle.result({ timeoutMs: 10_000, pollMs: 25 })

		expect(result).toEqual({ ok: true })
		expect(calls).toBe(2)
		const appRows = await client.execute('SELECT note FROM app_writes')
		expect(appRows.rows).toEqual([{ note: 'second-try' }])
	})
})
