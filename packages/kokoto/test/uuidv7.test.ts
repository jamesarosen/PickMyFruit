import { describe, expect, it } from 'vitest'
import { uuidv7 } from '../src/uuidv7.ts'

describe('uuidv7', () => {
	it('produces well-formed UUIDs', () => {
		const id = uuidv7()
		expect(id).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
		)
	})

	it('encodes the supplied timestamp in the leading 48 bits', () => {
		const ts = 1_700_000_000_000
		const id = uuidv7(ts)
		const hex = id.slice(0, 8) + id.slice(9, 13)
		expect(parseInt(hex, 16)).toBe(ts)
	})

	it('is monotonic when timestamp is monotonic', () => {
		const a = uuidv7(1)
		const b = uuidv7(2)
		expect(a < b).toBe(true)
	})
})
