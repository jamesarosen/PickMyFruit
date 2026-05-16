import { describe, it, expect } from 'vitest'
import {
	encodeCursor,
	decodeCursor,
	ORIGIN_CURSOR,
} from '../src/lib/internal-cursor.server'

describe('encodeCursor + decodeCursor', () => {
	it('round-trips a populated cursor', () => {
		const original = { updatedAt: 1_734_000_000_000, userId: 'user-abc' }
		expect(decodeCursor(encodeCursor(original))).toEqual(original)
	})

	it('round-trips the origin cursor', () => {
		expect(decodeCursor(encodeCursor(ORIGIN_CURSOR))).toEqual(ORIGIN_CURSOR)
	})

	it('produces a URL-safe string (no +, /, =)', () => {
		const encoded = encodeCursor({
			updatedAt: 9_999_999_999_999,
			userId: 'user-with/slash+plus=eq',
		})
		expect(encoded).not.toMatch(/[+/=]/)
	})

	it('returns ORIGIN_CURSOR for empty input', () => {
		expect(decodeCursor('')).toEqual(ORIGIN_CURSOR)
		expect(decodeCursor(null)).toEqual(ORIGIN_CURSOR)
		expect(decodeCursor(undefined)).toEqual(ORIGIN_CURSOR)
	})

	it('returns ORIGIN_CURSOR for unparseable input (rewind is idempotent)', () => {
		expect(decodeCursor('not-base64')).toEqual(ORIGIN_CURSOR)
		expect(decodeCursor('!!!')).toEqual(ORIGIN_CURSOR)
	})

	it('returns ORIGIN_CURSOR for JSON missing required fields', () => {
		const bad = Buffer.from('{"updatedAt":-1}', 'utf8').toString('base64url')
		expect(decodeCursor(bad)).toEqual(ORIGIN_CURSOR)
	})
})
