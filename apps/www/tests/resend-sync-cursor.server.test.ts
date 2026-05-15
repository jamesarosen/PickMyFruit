import { describe, it, expect, vi } from 'vitest'
import {
	cursorSchema,
	DEFAULT_CURSOR,
	readCursor,
	writeCursor,
	type Cursor,
} from '../src/data/resend-sync-cursor.server'

// ---------------------------------------------------------------------------
// Mock DB helpers
// ---------------------------------------------------------------------------

/** Builds a mock db that returns `rows` from the select().from().where().limit() chain. */
function makeSelectDb(rows: Array<{ value: string }>) {
	const limit = vi.fn().mockResolvedValue(rows)
	const where = vi.fn(() => ({ limit }))
	const from = vi.fn(() => ({ where }))
	const select = vi.fn(() => ({ from }))
	return { select } as unknown as Parameters<typeof readCursor>[0]
}

/** Builds a mock db that captures the value passed to set() in the upsert chain. */
function makeUpsertDb() {
	let capturedValue: string | undefined
	const onConflictDoUpdate = vi.fn(
		(args: { set: { value: string } }): Promise<void> => {
			capturedValue = args.set.value
			return Promise.resolve()
		}
	)
	const values = vi.fn(() => ({ onConflictDoUpdate }))
	const insert = vi.fn(() => ({ values }))
	return {
		db: { insert } as unknown as Parameters<typeof writeCursor>[0],
		getCapturedValue: () => capturedValue,
	}
}

/** Builds a mock db that supports a full read/write round-trip via an in-memory store. */
function makeRoundTripDb(initialValue: string) {
	let stored = initialValue

	const limit = vi.fn().mockImplementation(async () => [{ value: stored }])
	const selectWhere = vi.fn(() => ({ limit }))
	const from = vi.fn(() => ({ where: selectWhere }))
	const select = vi.fn(() => ({ from }))

	const onConflictDoUpdate = vi.fn(
		(args: { set: { value: string } }): Promise<void> => {
			stored = args.set.value
			return Promise.resolve()
		}
	)
	const values = vi.fn(() => ({ onConflictDoUpdate }))
	const insert = vi.fn(() => ({ values }))

	return { select, insert } as unknown as Parameters<typeof readCursor>[0] &
		Parameters<typeof writeCursor>[0]
}

// ---------------------------------------------------------------------------
// cursorSchema
// ---------------------------------------------------------------------------

describe('cursorSchema', () => {
	it('accepts the default sentinel values', () => {
		expect(cursorSchema.parse({ updatedAt: 0, userId: '' })).toEqual(
			DEFAULT_CURSOR
		)
	})

	it('accepts positive integer updatedAt with a non-empty userId', () => {
		const input = { updatedAt: 1_700_000_000_000, userId: 'user-abc' }
		expect(cursorSchema.parse(input)).toEqual(input)
	})

	it('rejects negative updatedAt', () => {
		expect(() => cursorSchema.parse({ updatedAt: -1, userId: '' })).toThrow()
	})

	it('rejects non-integer updatedAt', () => {
		expect(() => cursorSchema.parse({ updatedAt: 1.5, userId: '' })).toThrow()
	})

	it('rejects missing updatedAt', () => {
		expect(() => cursorSchema.parse({ userId: '' })).toThrow()
	})

	it('rejects missing userId', () => {
		expect(() => cursorSchema.parse({ updatedAt: 0 })).toThrow()
	})
})

// ---------------------------------------------------------------------------
// readCursor
// ---------------------------------------------------------------------------

describe('readCursor', () => {
	it('returns the stored cursor when the row is valid', async () => {
		const cursor: Cursor = { updatedAt: 1_000, userId: 'user-1' }
		const db = makeSelectDb([{ value: JSON.stringify(cursor) }])
		expect(await readCursor(db)).toEqual(cursor)
	})

	it('returns DEFAULT_CURSOR when the row is absent', async () => {
		const db = makeSelectDb([])
		expect(await readCursor(db)).toEqual(DEFAULT_CURSOR)
	})

	it('returns DEFAULT_CURSOR when the stored value is malformed JSON', async () => {
		const db = makeSelectDb([{ value: 'not-json' }])
		expect(await readCursor(db)).toEqual(DEFAULT_CURSOR)
	})

	it('returns DEFAULT_CURSOR when the JSON fails schema validation', async () => {
		const db = makeSelectDb([{ value: '{"updatedAt":-1,"userId":"x"}' }])
		expect(await readCursor(db)).toEqual(DEFAULT_CURSOR)
	})
})

// ---------------------------------------------------------------------------
// writeCursor
// ---------------------------------------------------------------------------

describe('writeCursor', () => {
	it('upserts the row with JSON-serialized cursor fields', async () => {
		const { db, getCapturedValue } = makeUpsertDb()
		const cursor: Cursor = { updatedAt: 2_000, userId: 'user-2' }
		await writeCursor(db, cursor)
		expect(JSON.parse(getCapturedValue()!)).toEqual(cursor)
	})
})

// ---------------------------------------------------------------------------
// round-trip
// ---------------------------------------------------------------------------

describe('round-trip', () => {
	it('reads back a cursor that was written', async () => {
		const db = makeRoundTripDb(JSON.stringify(DEFAULT_CURSOR))
		const cursor: Cursor = { updatedAt: 3_000, userId: 'user-3' }
		await writeCursor(db, cursor)
		expect(await readCursor(db)).toEqual(cursor)
	})

	it('overwrites a previous cursor on subsequent writes', async () => {
		const db = makeRoundTripDb(JSON.stringify(DEFAULT_CURSOR))
		await writeCursor(db, { updatedAt: 1_000, userId: 'first' })
		await writeCursor(db, { updatedAt: 2_000, userId: 'second' })
		expect(await readCursor(db)).toEqual({ updatedAt: 2_000, userId: 'second' })
	})
})
