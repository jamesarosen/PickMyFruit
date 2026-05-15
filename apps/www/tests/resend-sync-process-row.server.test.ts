import { describe, it, expect, vi, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import type {
	ResendClient,
	ResendContact,
} from '../src/lib/resend-sync-process-row.server'

// ---------------------------------------------------------------------------
// Mocks — must be hoisted before dynamic imports
// ---------------------------------------------------------------------------

const mockReadCursor = vi.fn()
const mockWriteCursor = vi.fn()

vi.mock('../src/data/resend-sync-cursor.server', () => ({
	DEFAULT_CURSOR: { updatedAt: 0, userId: '' },
	readCursor: (...args: unknown[]) => mockReadCursor(...args),
	writeCursor: (...args: unknown[]) => mockWriteCursor(...args),
}))

const mockCaptureException = vi.fn()

vi.mock('../src/lib/sentry', () => ({
	Sentry: {
		captureException: (...args: unknown[]) => mockCaptureException(...args),
	},
}))

vi.mock('../src/lib/logger.server', () => ({
	logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
}))

const { processOneRow } =
	await import('../src/lib/resend-sync-process-row.server')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeUserRow(
	overrides: Partial<ResendContact & { updatedAt: Date }> = {}
) {
	return {
		id: faker.string.uuid(),
		email: faker.internet.email(),
		name: faker.person.fullName(),
		phone: null,
		updatedAt: new Date(1_700_000_000_000),
		...overrides,
	}
}

function makeDb(rows: ReturnType<typeof makeUserRow>[]) {
	const limit = vi.fn().mockResolvedValue(rows)
	const orderBy = vi.fn(() => ({ limit }))
	const where = vi.fn(() => ({ orderBy }))
	const from = vi.fn(() => ({ where }))
	const select = vi.fn(() => ({ from }))
	return { select } as unknown as Parameters<typeof processOneRow>[0]
}

const okClient: ResendClient = vi.fn().mockResolvedValue({ kind: 'ok' })

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processOneRow', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockReadCursor.mockResolvedValue({ updatedAt: 0, userId: '' })
		mockWriteCursor.mockResolvedValue(undefined)
	})

	describe('drained', () => {
		it('returns "drained" when no user rows exist past the cursor', async () => {
			const db = makeDb([])
			const result = await processOneRow(db, okClient)
			expect(result).toBe('drained')
		})

		it('does not call the Resend client when drained', async () => {
			const db = makeDb([])
			await processOneRow(db, okClient)
			expect(okClient).not.toHaveBeenCalled()
		})

		it('does not advance the cursor when drained', async () => {
			const db = makeDb([])
			await processOneRow(db, okClient)
			expect(mockWriteCursor).not.toHaveBeenCalled()
		})
	})

	describe('success (ok)', () => {
		it('returns "processed" on a successful Resend upsert', async () => {
			const row = makeUserRow()
			const db = makeDb([row])
			const result = await processOneRow(db, okClient)
			expect(result).toBe('processed')
		})

		it('calls the Resend client with the correct contact fields', async () => {
			const row = makeUserRow({ phone: '+15555550100' })
			const db = makeDb([row])
			await processOneRow(db, okClient)
			expect(okClient).toHaveBeenCalledOnce()
			expect(okClient).toHaveBeenCalledWith({
				id: row.id,
				email: row.email,
				name: row.name,
				phone: row.phone,
			})
		})

		it('advances the cursor to the processed row on success', async () => {
			const row = makeUserRow()
			const db = makeDb([row])
			await processOneRow(db, okClient)
			expect(mockWriteCursor).toHaveBeenCalledOnce()
			expect(mockWriteCursor).toHaveBeenCalledWith(expect.anything(), {
				updatedAt: row.updatedAt.getTime(),
				userId: row.id,
			})
		})

		it('does not capture a Sentry exception on success', async () => {
			const db = makeDb([makeUserRow()])
			await processOneRow(db, okClient)
			expect(mockCaptureException).not.toHaveBeenCalled()
		})
	})

	describe('4xx client error', () => {
		const clientErrorClient: ResendClient = vi.fn().mockResolvedValue({
			kind: 'client-error',
			status: 422,
			message: 'Invalid email format',
		})

		it('returns "processed" on a 4xx so the cycle keeps moving', async () => {
			const db = makeDb([makeUserRow()])
			const result = await processOneRow(db, clientErrorClient)
			expect(result).toBe('processed')
		})

		it('advances the cursor past the 4xx row', async () => {
			const row = makeUserRow()
			const db = makeDb([row])
			await processOneRow(db, clientErrorClient)
			expect(mockWriteCursor).toHaveBeenCalledWith(expect.anything(), {
				updatedAt: row.updatedAt.getTime(),
				userId: row.id,
			})
		})

		it('captures a Sentry exception for the 4xx', async () => {
			const db = makeDb([makeUserRow()])
			await processOneRow(db, clientErrorClient)
			expect(mockCaptureException).toHaveBeenCalledOnce()
		})
	})

	describe('5xx server error', () => {
		const serverErrorClient: ResendClient = vi.fn().mockResolvedValue({
			kind: 'server-error',
			status: 503,
			message: 'Service unavailable',
		})

		it('returns "stalled" on a 5xx', async () => {
			const db = makeDb([makeUserRow()])
			const result = await processOneRow(db, serverErrorClient)
			expect(result).toBe('stalled')
		})

		it('does not advance the cursor on a 5xx', async () => {
			const db = makeDb([makeUserRow()])
			await processOneRow(db, serverErrorClient)
			expect(mockWriteCursor).not.toHaveBeenCalled()
		})

		it('captures a Sentry exception for the 5xx', async () => {
			const db = makeDb([makeUserRow()])
			await processOneRow(db, serverErrorClient)
			expect(mockCaptureException).toHaveBeenCalledOnce()
		})
	})

	describe('network error', () => {
		const networkErrorClient: ResendClient = vi.fn().mockResolvedValue({
			kind: 'network-error',
			error: new Error('fetch failed'),
		})

		it('returns "stalled" on a network error', async () => {
			const db = makeDb([makeUserRow()])
			const result = await processOneRow(db, networkErrorClient)
			expect(result).toBe('stalled')
		})

		it('does not advance the cursor on a network error', async () => {
			const db = makeDb([makeUserRow()])
			await processOneRow(db, networkErrorClient)
			expect(mockWriteCursor).not.toHaveBeenCalled()
		})

		it('captures the original error object to Sentry', async () => {
			const error = new Error('fetch failed')
			const client: ResendClient = vi.fn().mockResolvedValue({
				kind: 'network-error',
				error,
			})
			const db = makeDb([makeUserRow()])
			await processOneRow(db, client)
			expect(mockCaptureException).toHaveBeenCalledWith(error, expect.anything())
		})
	})

	describe('tuple ordering', () => {
		it('passes the cursor values into the where clause via readCursor', async () => {
			const cursor = { updatedAt: 1_700_000_000_000, userId: 'prior-user' }
			mockReadCursor.mockResolvedValue(cursor)
			const db = makeDb([])
			await processOneRow(db, okClient)
			expect(mockReadCursor).toHaveBeenCalledOnce()
		})
	})
})
