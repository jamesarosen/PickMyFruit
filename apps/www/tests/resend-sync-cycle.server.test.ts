import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ProcessOneRowResult } from '../src/lib/resend-sync-process-row.server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProcessOneRow =
	vi.fn<(db: unknown, client: unknown) => Promise<ProcessOneRowResult>>()

vi.mock('../src/lib/resend-sync-process-row.server', () => ({
	processOneRow: (db: unknown, client: unknown) => mockProcessOneRow(db, client),
}))

vi.mock('../src/lib/logger.server', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

const { runCycle } = await import('../src/lib/resend-sync-cycle.server')

// Stub values — runCycle forwards these to processOneRow, which is mocked
const db = {} as Parameters<typeof runCycle>[0]
const resendClient = vi.fn() as unknown as Parameters<typeof runCycle>[1]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runCycle', () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it('returns 0 when the queue is already drained on the first call', async () => {
		mockProcessOneRow.mockResolvedValueOnce('drained')
		expect(await runCycle(db, resendClient)).toBe(0)
	})

	it('calls processOneRow until drained and returns the row count', async () => {
		mockProcessOneRow
			.mockResolvedValueOnce('processed')
			.mockResolvedValueOnce('processed')
			.mockResolvedValueOnce('processed')
			.mockResolvedValueOnce('drained')

		expect(await runCycle(db, resendClient)).toBe(3)
		expect(mockProcessOneRow).toHaveBeenCalledTimes(4)
	})

	it('stops and returns the count so far when processOneRow stalls', async () => {
		mockProcessOneRow
			.mockResolvedValueOnce('processed')
			.mockResolvedValueOnce('stalled')

		expect(await runCycle(db, resendClient)).toBe(1)
		expect(mockProcessOneRow).toHaveBeenCalledTimes(2)
	})

	it('does not call processOneRow again after stall', async () => {
		mockProcessOneRow
			.mockResolvedValueOnce('stalled')
			.mockResolvedValueOnce('processed')

		await runCycle(db, resendClient)
		expect(mockProcessOneRow).toHaveBeenCalledTimes(1)
	})

	it('passes the db and resendClient through to processOneRow', async () => {
		mockProcessOneRow.mockResolvedValueOnce('drained')
		await runCycle(db, resendClient)
		expect(mockProcessOneRow).toHaveBeenCalledWith(db, resendClient)
	})

	it('stops between rows when the abort signal fires', async () => {
		const controller = new AbortController()
		mockProcessOneRow.mockImplementation(async () => {
			controller.abort()
			return 'processed'
		})

		const processed = await runCycle(db, resendClient, controller.signal)

		expect(processed).toBe(1)
		expect(mockProcessOneRow).toHaveBeenCalledTimes(1)
	})

	it('finishes the in-flight row even after abort fires mid-processing', async () => {
		const controller = new AbortController()
		// processOneRow is allowed to complete and advance the cursor; the loop
		// observes the signal only after that.
		mockProcessOneRow.mockImplementationOnce(async () => {
			controller.abort()
			return 'processed'
		})

		const processed = await runCycle(db, resendClient, controller.signal)

		expect(processed).toBe(1)
	})

	it('drains to completion when no signal is provided', async () => {
		mockProcessOneRow
			.mockResolvedValueOnce('processed')
			.mockResolvedValueOnce('processed')
			.mockResolvedValueOnce('drained')

		expect(await runCycle(db, resendClient)).toBe(2)
		expect(mockProcessOneRow).toHaveBeenCalledTimes(3)
	})
})
