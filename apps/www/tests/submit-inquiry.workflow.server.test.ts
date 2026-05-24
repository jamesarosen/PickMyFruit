import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createClient, type Client } from '@libsql/client/node'

const mockSendInquiryEmail = vi.fn()
const mockCreateInquiry = vi.fn()

vi.mock('../src/lib/email-templates.server', () => ({
	sendInquiryEmail: (...args: unknown[]) => mockSendInquiryEmail(...args),
}))

vi.mock('../src/data/queries.server', () => ({
	createInquiry: (...args: unknown[]) => mockCreateInquiry(...args),
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

	beforeEach(async () => {
		mockSendInquiryEmail.mockReset()
		mockCreateInquiry.mockReset()
		client = createClient({ url: ':memory:' })
		await client.execute('PRAGMA foreign_keys = ON')
	})

	afterEach(() => {
		client.close()
	})

	it('runs send-email then create-inquiry and returns the inquiry id', async () => {
		mockSendInquiryEmail.mockResolvedValue(undefined)
		mockCreateInquiry.mockResolvedValue({ id: 101 })

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
			expect(mockCreateInquiry).toHaveBeenCalledTimes(1)

			const [emailInput, emailOpts] = mockSendInquiryEmail.mock.calls[0]
			expect(emailInput.gleaner).toEqual(input.gleaner)
			expect(emailInput.owner).toEqual(input.owner)
			expect(emailInput.gleanerNote).toBe(input.note)
			expect(typeof emailOpts.idempotencyKey).toBe('string')
			expect(emailOpts.idempotencyKey).toContain('sendOwnerEmail')

			const inquiryArgs = mockCreateInquiry.mock.calls[0][0]
			expect(inquiryArgs.listingId).toBe(42)
			expect(inquiryArgs.gleanerId).toBe('usr_gleaner')
			expect(inquiryArgs.emailSentAt).toBeInstanceOf(Date)
		} finally {
			await runtime.stop()
		}
	})

	it('forwards a stable per-step idempotency key to the email send', async () => {
		mockSendInquiryEmail.mockResolvedValue(undefined)
		mockCreateInquiry.mockResolvedValue({ id: 202 })

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
		mockCreateInquiry.mockResolvedValue({ id: 303 })

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
			expect(mockCreateInquiry).toHaveBeenCalledTimes(1)
		} finally {
			await runtime.stop()
		}
	})
})
