import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type Client } from '@libsql/client/node'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mockSendInquiryEmail = vi.fn()
const mockCreateInquiryTx = vi.fn()

vi.mock('../src/lib/email-templates.server', () => ({
	sendInquiryEmail: (...args: unknown[]) => mockSendInquiryEmail(...args),
}))

vi.mock('../src/data/queries.server', () => ({
	createInquiryTx: (...args: unknown[]) => mockCreateInquiryTx(...args),
}))

const { submitInquiryWorkflow, inquiryWorkflowIdempotencyKey } =
	await import('../src/workflows/submit-inquiry.workflow.server')
const { createRuntime } = await import('@pickmyfruit/kokoto/runtime.server')

function makeInput(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		listingId: 42,
		gleanerId: 'usr_gleaner',
		note: 'Would love some apples',
		baseUrl: 'https://example.test',
		gleaner: { name: 'Gail Gleaner', email: 'gail@example.test' },
		owner: { name: 'Olive Owner', email: 'olive@example.test' },
		listing: {
			id: 42,
			type: 'apple',
			notes: null,
			quantity: '2 lbs',
		},
		...overrides,
	}
}

describe('submitInquiryWorkflow', () => {
	let client: Client
	let tempDir: string

	beforeEach(async () => {
		mockSendInquiryEmail.mockReset()
		mockCreateInquiryTx.mockReset()
		// libsql `:memory:` drops the schema on `tx.rollback()`, which would
		// hide problems in `ctx.txStep`. Use a temp file so tests behave like
		// production SQLite.
		tempDir = mkdtempSync(join(tmpdir(), 'inquiry-wf-'))
		client = createClient({ url: `file:${join(tempDir, 'test.db')}` })
		await client.execute('PRAGMA foreign_keys = ON')
	})

	afterEach(() => {
		client.close()
		rmSync(tempDir, { recursive: true, force: true })
	})

	it('runs send-email then create-inquiry and returns the inquiry id', async () => {
		mockSendInquiryEmail.mockResolvedValue(undefined)
		mockCreateInquiryTx.mockResolvedValue({ id: 101 })

		const runtime = createRuntime({ client, pollMs: 10 })
		await runtime.createSchema()
		await runtime.start({
			workflows: [submitInquiryWorkflow],
			queues: [{ name: 'email', concurrency: 4 }],
		})

		try {
			const input = makeInput()
			const handle = await runtime.startWorkflow(submitInquiryWorkflow, input)
			const result = await handle.result({ timeoutMs: 5_000 })

			expect(result).toEqual({ inquiryId: 101 })
			expect(mockSendInquiryEmail).toHaveBeenCalledTimes(1)
			expect(mockCreateInquiryTx).toHaveBeenCalledTimes(1)

			const [emailInput, emailOpts] = mockSendInquiryEmail.mock.calls[0]
			expect(emailInput.gleaner).toEqual(input.gleaner)
			expect(emailInput.owner).toEqual(input.owner)
			expect(emailInput.gleanerNote).toBe(input.note)
			expect(typeof emailOpts.idempotencyKey).toBe('string')
			expect(emailOpts.idempotencyKey).toContain('sendOwnerEmail')

			// createInquiryTx is called with (tx, data) — tx is the libsql
			// transaction provided by kokoto.
			const [, inquiryArgs] = mockCreateInquiryTx.mock.calls[0]
			expect(inquiryArgs.listingId).toBe(42)
			expect(inquiryArgs.gleanerId).toBe('usr_gleaner')
			expect(inquiryArgs.emailSentAt).toBeInstanceOf(Date)
		} finally {
			await runtime.stop()
		}
	})

	it('forwards a stable per-step idempotency key to the email send', async () => {
		mockSendInquiryEmail.mockResolvedValue(undefined)
		mockCreateInquiryTx.mockResolvedValue({ id: 202 })

		const runtime = createRuntime({ client, pollMs: 10 })
		await runtime.createSchema()
		await runtime.start({
			workflows: [submitInquiryWorkflow],
			queues: [{ name: 'email', concurrency: 4 }],
		})

		try {
			const handle = await runtime.startWorkflow(
				submitInquiryWorkflow,
				makeInput()
			)
			await handle.result({ timeoutMs: 5_000 })
			const [, emailOpts] = mockSendInquiryEmail.mock.calls[0]
			expect(emailOpts.idempotencyKey).toBe(`${handle.id}:sendOwnerEmail`)
		} finally {
			await runtime.stop()
		}
	})

	it('deduplicates duplicate submits via the workflow idempotency key', async () => {
		mockSendInquiryEmail.mockResolvedValue(undefined)
		mockCreateInquiryTx.mockResolvedValue({ id: 303 })

		const runtime = createRuntime({ client, pollMs: 10 })
		await runtime.createSchema()
		await runtime.start({
			workflows: [submitInquiryWorkflow],
			queues: [{ name: 'email', concurrency: 4 }],
		})

		try {
			const key = inquiryWorkflowIdempotencyKey(
				42,
				'usr_gleaner',
				new Date('2026-05-24T12:00:00Z')
			)
			expect(key).toBe('inquiry:42:usr_gleaner:2026-05-24')

			const first = await runtime.startWorkflow(
				submitInquiryWorkflow,
				makeInput(),
				{ idempotencyKey: key }
			)
			const second = await runtime.startWorkflow(
				submitInquiryWorkflow,
				makeInput(),
				{ idempotencyKey: key }
			)
			expect(second.id).toBe(first.id)

			const result = await first.result({ timeoutMs: 5_000 })
			expect(result).toEqual({ inquiryId: 303 })
			expect(mockSendInquiryEmail).toHaveBeenCalledTimes(1)
			expect(mockCreateInquiryTx).toHaveBeenCalledTimes(1)
		} finally {
			await runtime.stop()
		}
	})

	// Regression for P0.1 / P0.2: a transient failure in createInquiryTx must
	// be retried, and the previous attempt's user write must NOT survive.
	it('rolls back and re-runs createInquiryTx on transient failure', async () => {
		mockSendInquiryEmail.mockResolvedValue(undefined)
		mockCreateInquiryTx
			.mockRejectedValueOnce(new Error('SQLITE_BUSY: transient'))
			.mockResolvedValueOnce({ id: 404 })

		const runtime = createRuntime({ client, pollMs: 10 })
		await runtime.createSchema()
		await runtime.start({
			workflows: [submitInquiryWorkflow],
			queues: [{ name: 'email', concurrency: 4 }],
		})

		try {
			const handle = await runtime.startWorkflow(
				submitInquiryWorkflow,
				makeInput(),
				{ maxAttempts: 3 }
			)
			const result = await handle.result({ timeoutMs: 10_000, pollMs: 25 })
			expect(result).toEqual({ inquiryId: 404 })
			// Email replays from the cached success step row, so it is sent
			// exactly once across both attempts.
			expect(mockSendInquiryEmail).toHaveBeenCalledTimes(1)
			// createInquiryTx is called twice: first attempt threw (rolled back),
			// second attempt succeeded.
			expect(mockCreateInquiryTx).toHaveBeenCalledTimes(2)
		} finally {
			await runtime.stop()
		}
	})
})
