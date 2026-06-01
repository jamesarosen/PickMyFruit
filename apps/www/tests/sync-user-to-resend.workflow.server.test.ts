import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type Client } from '@libsql/client/node'

const mockCreateResendContactUpsert = vi.fn()

vi.mock('../src/lib/resend-contacts.server', () => ({
	createResendContactUpsert: (...args: unknown[]) =>
		mockCreateResendContactUpsert(...args),
}))

const { syncUserToResendWorkflow, syncUserIdempotencyKey } =
	await import('../src/workflows/sync-user-to-resend.workflow.server')
const { createRuntime } = await import('@pickmyfruit/kokoto/runtime.server')

describe('syncUserToResendWorkflow', () => {
	let client: Client

	beforeEach(async () => {
		mockCreateResendContactUpsert.mockReset()
		client = createClient({ url: ':memory:' })
		await client.execute('PRAGMA foreign_keys = ON')
	})

	afterEach(() => {
		client.close()
	})

	it('skips the Resend call when EMAIL_PROVIDER is not resend (test env)', async () => {
		// vitest.config sets EMAIL_PROVIDER=silent in the node-tests project, so
		// the workflow body short-circuits before calling Resend at all.
		const runtime = createRuntime({ client, pollMs: 10 })
		await runtime.createSchema()
		await runtime.start({
			workflows: [syncUserToResendWorkflow],
			queues: [{ name: 'resend', concurrency: 2 }],
		})

		try {
			const handle = await runtime.startWorkflow(syncUserToResendWorkflow, {
				userId: 'usr_1',
				email: 'a@example.com',
				name: 'Alice',
				updatedAtMs: 1_700_000_000_000,
			})
			await handle.result({ timeoutMs: 5_000 })
			expect(mockCreateResendContactUpsert).not.toHaveBeenCalled()
		} finally {
			await runtime.stop()
		}
	})

	it('builds a stable per-revision idempotency key', () => {
		const a = syncUserIdempotencyKey('usr_1', 1_700_000_000_000)
		const b = syncUserIdempotencyKey('usr_1', 1_700_000_000_000)
		const c = syncUserIdempotencyKey('usr_1', 1_700_000_000_001)
		expect(a).toBe(b)
		expect(a).not.toBe(c)
		expect(a).toBe('sync-user:usr_1:1700000000000')
	})

	it('deduplicates duplicate enqueues for the same revision', async () => {
		const runtime = createRuntime({ client, pollMs: 10 })
		await runtime.createSchema()
		await runtime.start({
			workflows: [syncUserToResendWorkflow],
			queues: [{ name: 'resend', concurrency: 2 }],
		})

		try {
			const input = {
				userId: 'usr_2',
				email: 'b@example.com',
				name: 'Bob',
				updatedAtMs: 1_700_000_000_000,
			}
			const key = syncUserIdempotencyKey(input.userId, input.updatedAtMs)

			const first = await runtime.startWorkflow(syncUserToResendWorkflow, input, {
				idempotencyKey: key,
			})
			const second = await runtime.startWorkflow(syncUserToResendWorkflow, input, {
				idempotencyKey: key,
			})
			expect(second.id).toBe(first.id)
			await first.result({ timeoutMs: 5_000 })
		} finally {
			await runtime.stop()
		}
	})
})
