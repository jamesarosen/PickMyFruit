import { describe, it, expect, vi, beforeEach } from 'vitest'
import { sleep, runWorker } from '../src/lib/resend-sync-main.server'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRunCycle =
	vi.fn<
		(db: unknown, client: unknown, signal?: AbortSignal) => Promise<number>
	>()

vi.mock('../src/lib/resend-sync-cycle.server', () => ({
	runCycle: (db: unknown, client: unknown, signal?: AbortSignal) =>
		mockRunCycle(db, client, signal),
}))

vi.mock('../src/lib/logger.server', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

const db = {} as Parameters<typeof runWorker>[0]['db']
const resendClient = vi.fn() as unknown as Parameters<
	typeof runWorker
>[0]['resendClient']

// ---------------------------------------------------------------------------
// sleep()
// ---------------------------------------------------------------------------

describe('sleep', () => {
	it('resolves after the given duration', async () => {
		vi.useFakeTimers()
		const promise = sleep(1_000, new AbortController().signal)
		vi.advanceTimersByTime(1_000)
		await expect(promise).resolves.toBeUndefined()
		vi.useRealTimers()
	})

	it('resolves immediately when the signal is already aborted', async () => {
		const controller = new AbortController()
		controller.abort()
		await expect(sleep(60_000, controller.signal)).resolves.toBeUndefined()
	})

	it('resolves early when the signal is aborted during the sleep', async () => {
		const controller = new AbortController()
		const promise = sleep(60_000, controller.signal)
		controller.abort()
		await expect(promise).resolves.toBeUndefined()
	})
})

// ---------------------------------------------------------------------------
// runWorker()
// ---------------------------------------------------------------------------

describe('runWorker', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockRunCycle.mockResolvedValue(0)
	})

	it('does not call runCycle when already aborted', async () => {
		const controller = new AbortController()
		controller.abort()

		await runWorker({
			db,
			resendClient,
			pollMs: 1_000,
			signal: controller.signal,
		})

		expect(mockRunCycle).not.toHaveBeenCalled()
	})

	it('calls runCycle once then exits when abort is queued after the first call', async () => {
		const controller = new AbortController()

		mockRunCycle.mockImplementationOnce(async () => {
			// Abort via microtask so sleep sees signal.aborted = true and skips the timer.
			queueMicrotask(() => controller.abort())
			return 0
		})

		await runWorker({ db, resendClient, pollMs: 0, signal: controller.signal })

		expect(mockRunCycle).toHaveBeenCalledOnce()
	})

	it('exits cleanly when the signal fires while sleeping between cycles', async () => {
		const controller = new AbortController()

		// Single cycle, then the worker sleeps for a long time.
		// We abort from outside to wake the sleep early.
		mockRunCycle.mockImplementationOnce(async () => 0)

		const promise = runWorker({
			db,
			resendClient,
			pollMs: 60_000,
			signal: controller.signal,
		})

		// One microtask tick lets runCycle complete; the next lets runWorker enter sleep.
		await Promise.resolve()
		await Promise.resolve()

		// Abort fires the signal listener inside sleep(), resolving it immediately.
		controller.abort()

		await promise

		expect(mockRunCycle).toHaveBeenCalledOnce()
	})

	it('passes the db, resendClient, and signal through to runCycle', async () => {
		const controller = new AbortController()

		mockRunCycle.mockImplementationOnce(async () => {
			queueMicrotask(() => controller.abort())
			return 0
		})

		await runWorker({ db, resendClient, pollMs: 0, signal: controller.signal })

		expect(mockRunCycle).toHaveBeenCalledWith(db, resendClient, controller.signal)
	})
})
